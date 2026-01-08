import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * CityHall - Main building that must be defended
 * Loss condition when destroyed
 *
 * From PRD:
 * - Mesh: Large box (3×1×3) with #D8E2F0 material
 * - HP: 1000
 * - Passive: +$10/sec baseline (handled by MoneyCounter)
 */
export class CityHall extends Object3DComponent {
    static StateProperties = [
        'health', 'maxHealth', 'armor', 'invulnerabilityTime',
        'healthBarWidth', 'healthBarHeight', 'healthBarOffset'
    ]
    static ComponentType = 'CityHall'

    // Health system (PRD says 1000 HP)
    health = 1000
    maxHealth = 1000
    armor = 10
    invulnerabilityTime = 0.2 // seconds between damage

    // Health bar configuration
    healthBarWidth = 6.0      // large building-scale
    healthBarHeight = 0.6
    healthBarOffset = 2.5     // height above building

    // Internal state
    _isAlive = true
    _lastDamageTime = 0
    _displayedHealth = 1000

    // Health bar components
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null
    _healthText = null
    _textCanvas = null
    _textTexture = null

    // Building geometry
    _buildingMesh = null

    // Physics body (static - blocks enemies from clipping through)
    _physicsBody = null

    get isAlive() {
        return this._isAlive && this.health > 0
    }

    get isInvulnerable() {
        const now = Date.now()
        return (now - this._lastDamageTime) < (this.invulnerabilityTime * 1000)
    }

    start() {
        if (super.start) super.start()

        // Fixed health per PRD (1000 HP)
        this.maxHealth = 1000
        this.health = this.maxHealth
        this._displayedHealth = this.health

        // Create building geometry
        this._createBuildingGeometry()

        // Create physics body (STATIC - blocks enemies)
        this._createPhysicsBody()

        // Create health bar
        this._createHealthBar()
    }

    /**
     * Create a STATIC physics body for City Hall
     * This prevents enemies from clipping through the building
     */
    _createPhysicsBody() {
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager || !physicsManager.world) {
            console.warn('[CityHall] No physics world available')
            return
        }

        // City Hall is 3x1x3 box at y=0.5 (center)
        // Create a static box shape
        const halfExtents = new CANNON.Vec3(1.5, 0.5, 1.5)  // Half of 3x1x3
        const shape = new CANNON.Box(halfExtents)

        // Create static body (mass = 0 means static)
        this._physicsBody = new CANNON.Body({
            mass: 0,  // Static body
            type: CANNON.Body.STATIC,
            shape: shape,
            // Collision group: use a unique group for buildings
            // Buildings should collide with enemies (group 1) but not friendlies
            collisionFilterGroup: 1 << 4,  // Group 16: Buildings
            collisionFilterMask: (1 << 0) | (1 << 1) | (1 << 2)  // Collide with enemies, player, friendlies
        })

        // Position at object's world position
        const worldPos = new THREE.Vector3()
        this.object.getWorldPosition(worldPos)
        this._physicsBody.position.set(worldPos.x, worldPos.y, worldPos.z)

        // Add to physics world
        physicsManager.world.addBody(this._physicsBody)

        console.log(`[CityHall] Created static physics body at (${worldPos.x}, ${worldPos.y}, ${worldPos.z})`)
    }

    _removePhysicsBody() {
        if (this._physicsBody) {
            const physicsManager = getPhysicsWorldManager()
            if (physicsManager && physicsManager.world) {
                physicsManager.world.removeBody(this._physicsBody)
            }
            this._physicsBody = null
        }
    }

    /**
     * Create the City Hall building geometry
     * PRD: Large box (3×1×3) with #D8E2F0 material
     */
    _createBuildingGeometry() {
        if (!this.object) return

        // Check if there's already visible geometry
        let hasGeometry = false
        this.object.traverse((child) => {
            if (child.isMesh && child.geometry) {
                hasGeometry = true
            }
        })

        if (hasGeometry) return  // Already has geometry

        // Create main building box (3×1×3)
        const geometry = new THREE.BoxGeometry(3, 1, 3)
        const material = new THREE.MeshStandardMaterial({
            color: 0xD8E2F0,  // PRD color: #D8E2F0
            roughness: 0.5,
            metalness: 0.1,
            emissive: 0xD8E2F0,
            emissiveIntensity: 0.05
        })

        this._buildingMesh = new THREE.Mesh(geometry, material)
        this._buildingMesh.castShadow = true
        this._buildingMesh.receiveShadow = true
        this._buildingMesh.name = 'CityHallBuilding'

        this.object.add(this._buildingMesh)

        // Add a roof/detail on top
        const roofGeometry = new THREE.BoxGeometry(2.5, 0.3, 2.5)
        const roofMaterial = new THREE.MeshStandardMaterial({
            color: 0xBBCCDD,
            roughness: 0.6,
            metalness: 0.2
        })
        const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial)
        roofMesh.position.y = 0.65
        roofMesh.castShadow = true
        roofMesh.name = 'CityHallRoof'
        this.object.add(roofMesh)
    }

    stop() {
        if (super.stop) super.stop()
        this._removeHealthBar()
        this._removeBuildingGeometry()
        this._removePhysicsBody()
    }

    _removeBuildingGeometry() {
        if (!this.object) return

        // Remove building mesh and roof
        const toRemove = []
        this.object.traverse((child) => {
            if (child.name === 'CityHallBuilding' || child.name === 'CityHallRoof') {
                toRemove.push(child)
            }
        })

        for (const mesh of toRemove) {
            mesh.geometry?.dispose()
            mesh.material?.dispose()
            this.object.remove(mesh)
        }

        this._buildingMesh = null
    }

    // ==================== HEALTH BAR ====================

    _createHealthBar() {
        if (!this.object) return

        // Create group to hold health bar components
        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'CityHallHealthBar'

        // Background bar (dark)
        const bgGeometry = new THREE.PlaneGeometry(this.healthBarWidth, this.healthBarHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
        })
        this._healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        this._healthBarBg.renderOrder = 1000
        this._healthBarGroup.add(this._healthBarBg)

        // Health fill bar (green -> red gradient)
        const fillGeometry = new THREE.PlaneGeometry(this.healthBarWidth - 0.12, this.healthBarHeight - 0.12)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        })
        this._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this._healthBarFill.position.z = 0.02 // slightly in front
        this._healthBarFill.renderOrder = 1001
        this._healthBarGroup.add(this._healthBarFill)

        // Create text display for exact HP
        this._createHealthText()

        // Position above building
        this._healthBarGroup.position.y = this.healthBarOffset

        this.object.add(this._healthBarGroup)
    }

    _createHealthText() {
        // Create canvas for text
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 128
        const ctx = canvas.getContext('2d')

        // Style
        ctx.font = 'bold 80px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        // Initial text
        this._updateHealthTextCanvas(ctx, canvas)

        // Create texture
        this._textTexture = new THREE.CanvasTexture(canvas)
        this._textTexture.needsUpdate = true

        // Create mesh
        const textGeometry = new THREE.PlaneGeometry(4, 1)
        const textMaterial = new THREE.MeshBasicMaterial({
            map: this._textTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        })
        this._healthText = new THREE.Mesh(textGeometry, textMaterial)
        this._healthText.position.y = -1.2 // below health bar
        this._healthText.position.z = 0.03
        this._healthText.renderOrder = 1002
        this._healthBarGroup.add(this._healthText)

        this._textCanvas = canvas
    }

    _updateHealthTextCanvas(ctx, canvas) {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Draw text with outline
        const text = `${Math.ceil(this._displayedHealth)} / ${this.maxHealth}`

        // Outline
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 8
        ctx.strokeText(text, canvas.width / 2, canvas.height / 2)

        // Fill
        const healthPercent = this._displayedHealth / this.maxHealth
        if (healthPercent > 0.6) {
            ctx.fillStyle = '#44ff44' // Green
        } else if (healthPercent > 0.3) {
            ctx.fillStyle = '#ffaa00' // Orange
        } else {
            ctx.fillStyle = '#ff4444' // Red
        }
        ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    }

    _removeHealthBar() {
        if (this._healthBarGroup && this.object) {
            this.object.remove(this._healthBarGroup)
            this._healthBarBg?.geometry.dispose()
            this._healthBarBg?.material.dispose()
            this._healthBarFill?.geometry.dispose()
            this._healthBarFill?.material.dispose()
            this._healthText?.geometry.dispose()
            this._healthText?.material.dispose()
            this._textTexture?.dispose()
        }
        this._healthBarGroup = null
        this._healthBarFill = null
        this._healthBarBg = null
        this._healthText = null
        this._textCanvas = null
        this._textTexture = null
    }

    _updateHealthBar(deltaTime) {
        if (!this._healthBarGroup || !this._healthBarFill) return

        // Smooth health animation
        const healthLerpSpeed = 3
        const dt = deltaTime / 1000
        this._displayedHealth += (this.health - this._displayedHealth) * Math.min(1, healthLerpSpeed * dt)

        // Update fill scale (0 to 1)
        const healthPercent = Math.max(0, this._displayedHealth / this.maxHealth)
        this._healthBarFill.scale.x = healthPercent

        // Offset to keep bar left-aligned
        const barWidth = this.healthBarWidth - 0.12
        this._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Color gradient: green -> yellow -> orange -> red
        const color = new THREE.Color()
        if (healthPercent > 0.6) {
            // Green to yellow (60-100%)
            const t = (healthPercent - 0.6) / 0.4
            color.setRGB(
                0.27 + (1 - t) * 0.73, // 0.27 to 1.0
                1,
                0.27
            )
        } else if (healthPercent > 0.3) {
            // Yellow to orange (30-60%)
            const t = (healthPercent - 0.3) / 0.3
            color.setRGB(
                1,
                0.67 + t * 0.33, // 0.67 to 1.0
                0.1
            )
        } else {
            // Orange to red (0-30%)
            const t = healthPercent / 0.3
            color.setRGB(
                1,
                t * 0.27, // 0 to 0.27
                0.1
            )
        }
        this._healthBarFill.material.color = color

        // Update text every few frames (not every frame for performance)
        if (Math.abs(this._displayedHealth - this.health) > 1 || Math.random() < 0.1) {
            const ctx = this._textCanvas.getContext('2d')
            this._updateHealthTextCanvas(ctx, this._textCanvas)
            this._textTexture.needsUpdate = true
        }

        // Billboard: face camera
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera && this.object) {
            const cameraWorldPos = new THREE.Vector3()
            camera.getWorldPosition(cameraWorldPos)
            this._healthBarGroup.lookAt(cameraWorldPos)
        }
    }

    // ==================== COMBAT ====================

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return
        if (this.isInvulnerable) return

        // Apply armor reduction
        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage
        this._lastDamageTime = Date.now()

        //console.log(`[CityHall] Took ${effectiveDamage} damage (${Math.ceil(this.health)}/${this.maxHealth} HP)`)

        if (this.health <= 0) {
            this._die(attacker)
        }
    }

    heal(amount) {
        if (!this.isAlive) return

        const oldHealth = this.health
        this.health = Math.min(this.maxHealth, this.health + amount)
        const actualHeal = this.health - oldHealth

        //console.log(`[CityHall] Healed ${actualHeal} HP (${Math.ceil(this.health)}/${this.maxHealth})`)
    }

    _die(attacker = null) {
        this._isAlive = false
        console.error('[CityHall] DESTROYED! Game Over!')

        // Visual feedback
        if (this.object) {
            this.object.visible = false
        }

        // Trigger game over
        this._triggerGameOver()
    }

    _triggerGameOver() {
        // Create game over UI overlay
        const gameOverDiv = document.createElement('div')
        gameOverDiv.style.position = 'fixed'
        gameOverDiv.style.top = '50%'
        gameOverDiv.style.left = '50%'
        gameOverDiv.style.transform = 'translate(-50%, -50%)'
        gameOverDiv.style.fontSize = '120px'
        gameOverDiv.style.fontWeight = 'bold'
        gameOverDiv.style.color = '#ff0000'
        gameOverDiv.style.textAlign = 'center'
        gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'
        gameOverDiv.style.padding = '60px 120px'
        gameOverDiv.style.borderRadius = '20px'
        gameOverDiv.style.zIndex = '10000'
        gameOverDiv.style.textShadow = '0 0 20px rgba(255, 0, 0, 0.8)'
        gameOverDiv.textContent = 'GAME OVER'

        document.body.appendChild(gameOverDiv)

        // Add subtitle
        const subtitleDiv = document.createElement('div')
        subtitleDiv.style.fontSize = '40px'
        subtitleDiv.style.marginTop = '20px'
        subtitleDiv.style.color = '#ffffff'
        subtitleDiv.textContent = 'City Hall Destroyed'
        gameOverDiv.appendChild(subtitleDiv)
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        if (!this.object) return false

        // Always update health bar
        this._updateHealthBar(deltaTime)

        return true
    }

    // ==================== UI CONFIG ====================

    TestDamage = () => {
        this.takeDamage(500)
    }

    TestHeal = () => {
        this.heal(1000)
    }

    ResetHealth = () => {
        this.health = this.maxHealth
        this._displayedHealth = this.health
        this._isAlive = true
        if (this.object) {
            this.object.visible = true
        }
        //console.log('[CityHall] Health reset')

        // Remove game over UI if exists
        const gameOverDiv = document.querySelector('div')
        if (gameOverDiv && gameOverDiv.textContent === 'GAME OVER') {
            gameOverDiv.remove()
        }
    }

    uiConfig = {
        type: 'folder',
        label: 'City Hall',
        children: [
            {
                type: 'button',
                label: 'Test Damage (500)',
                onClick: this.TestDamage,
            },
            {
                type: 'button',
                label: 'Test Heal (1000)',
                onClick: this.TestHeal,
            },
            {
                type: 'button',
                label: 'Reset Health',
                onClick: this.ResetHealth,
            },
        ],
    }
}
