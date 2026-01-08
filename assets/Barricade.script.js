import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * Barricade - Defensive wall building that blocks enemy movement
 *
 * Specifications:
 * - HP: 500
 * - Armor: 5
 * - Cost: $100 (handled by BuildingPlacer)
 * - Static physics body blocks enemies
 */
export class Barricade extends Object3DComponent {
    static StateProperties = [
        'health', 'maxHealth', 'armor', 'invulnerabilityTime',
        'healthBarWidth', 'healthBarHeight', 'healthBarOffset'
    ]
    static ComponentType = 'Barricade'

    // Health system
    health = 500
    maxHealth = 500
    armor = 5
    invulnerabilityTime = 0.15 // seconds between damage

    // Health bar configuration
    healthBarWidth = 1.2
    healthBarHeight = 0.15
    healthBarOffset = 2.3 // height above building

    // Internal state
    _isAlive = true
    _lastDamageTime = 0
    _displayedHealth = 500

    // Visual components
    _buildingMesh = null
    _meshGroup = null
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null

    // Physics
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

        this.health = this.maxHealth
        this._displayedHealth = this.health
        this._isAlive = true

        this._createBuildingGeometry()
        this._createPhysicsBody()
        this._createHealthBar()
    }

    stop() {
        if (super.stop) super.stop()
        this._removeHealthBar()
        this._removeBuildingGeometry()
        this._removePhysicsBody()
    }

    // ==================== BUILDING GEOMETRY ====================

    _createBuildingGeometry() {
        if (!this.object) return

        // Check if already has geometry
        if (this._meshGroup) return

        this._meshGroup = new THREE.Group()
        this._meshGroup.name = 'BarricadeMeshGroup'

        const material = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.8,
            metalness: 0.2,
            emissive: 0x808080,
            emissiveIntensity: 0.02
        })

        const stripMaterial = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.4,
            metalness: 0.6
        })

        // Main wall (1x2x0.3)
        const wallGeo = new THREE.BoxGeometry(1, 2, 0.3)
        const wall = new THREE.Mesh(wallGeo, material.clone())
        wall.position.y = 1
        wall.castShadow = true
        wall.receiveShadow = true
        wall.name = 'BarricadeWall'
        this._meshGroup.add(wall)

        // Metal strips
        this._addStrips(stripMaterial)

        this.object.add(this._meshGroup)

        // Store main mesh reference for damage flash
        this._buildingMesh = wall
    }

    _addStrips(stripMaterial) {
        const stripGeo = new THREE.BoxGeometry(1.1, 0.1, 0.35)
        const yPositions = [0.2, 1.0, 1.8]

        for (const y of yPositions) {
            const strip = new THREE.Mesh(stripGeo, stripMaterial.clone())
            strip.position.set(0, y, 0)
            strip.castShadow = true
            strip.name = 'BarricadeStrip'
            this._meshGroup.add(strip)
        }
    }

    _removeBuildingGeometry() {
        if (!this.object) return

        if (this._meshGroup) {
            this._meshGroup.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose()
                    child.material?.dispose()
                }
            })
            this.object.remove(this._meshGroup)
            this._meshGroup = null
        }

        this._buildingMesh = null
    }

    // ==================== PHYSICS ====================

    _createPhysicsBody() {
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager || !physicsManager.world) {
            console.warn('[Barricade] No physics world available')
            return
        }

        this._physicsBody = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            collisionFilterGroup: 1 << 4,
            collisionFilterMask: (1 << 0) | (1 << 1) | (1 << 2)
        })

        // Simple box shape matching wall dimensions
        const halfExtents = new CANNON.Vec3(0.5, 1, 0.15)
        this._physicsBody.addShape(new CANNON.Box(halfExtents))

        // Position at object's world position
        const worldPos = new THREE.Vector3()
        this.object.getWorldPosition(worldPos)
        this._physicsBody.position.set(worldPos.x, worldPos.y + 1, worldPos.z)

        // Match object rotation
        const worldQuat = new THREE.Quaternion()
        this.object.getWorldQuaternion(worldQuat)
        this._physicsBody.quaternion.set(worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w)

        physicsManager.world.addBody(this._physicsBody)
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

    // ==================== HEALTH BAR ====================

    _createHealthBar() {
        if (!this.object) return

        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'BarricadeHealthBar'

        // Background bar
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

        // Health fill bar
        const fillGeometry = new THREE.PlaneGeometry(this.healthBarWidth - 0.06, this.healthBarHeight - 0.04)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        })
        this._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this._healthBarFill.position.z = 0.01
        this._healthBarFill.renderOrder = 1001
        this._healthBarGroup.add(this._healthBarFill)

        this._healthBarGroup.position.y = this.healthBarOffset
        this.object.add(this._healthBarGroup)
    }

    _removeHealthBar() {
        if (this._healthBarGroup && this.object) {
            this.object.remove(this._healthBarGroup)
            this._healthBarBg?.geometry.dispose()
            this._healthBarBg?.material.dispose()
            this._healthBarFill?.geometry.dispose()
            this._healthBarFill?.material.dispose()
        }
        this._healthBarGroup = null
        this._healthBarFill = null
        this._healthBarBg = null
    }

    _updateHealthBar(deltaTime) {
        if (!this._healthBarGroup || !this._healthBarFill) return

        // Smooth health animation
        const dt = deltaTime / 1000
        this._displayedHealth += (this.health - this._displayedHealth) * Math.min(1, 5 * dt)

        // Update fill scale
        const healthPercent = Math.max(0, this._displayedHealth / this.maxHealth)
        this._healthBarFill.scale.x = healthPercent

        // Left-align the fill bar
        const barWidth = this.healthBarWidth - 0.06
        this._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Color gradient
        const color = new THREE.Color()
        if (healthPercent > 0.6) {
            color.setRGB(0.27 + (1 - (healthPercent - 0.6) / 0.4) * 0.73, 1, 0.27)
        } else if (healthPercent > 0.3) {
            const t = (healthPercent - 0.3) / 0.3
            color.setRGB(1, 0.67 + t * 0.33, 0.1)
        } else {
            const t = healthPercent / 0.3
            color.setRGB(1, t * 0.27, 0.1)
        }
        this._healthBarFill.material.color = color

        // Billboard: face camera
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera) {
            const cameraWorldPos = new THREE.Vector3()
            camera.getWorldPosition(cameraWorldPos)
            this._healthBarGroup.lookAt(cameraWorldPos)
        }
    }

    // ==================== COMBAT ====================

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return
        if (this.isInvulnerable) return

        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage
        this._lastDamageTime = Date.now()

        // Flash red on damage
        this._flashDamage()

        if (this.health <= 0) {
            this._die(attacker)
        }
    }

    _flashDamage() {
        if (!this._meshGroup) return

        this._meshGroup.traverse((child) => {
            if (child.isMesh && child.material && child.name.startsWith('BarricadeWall')) {
                const mat = child.material
                const originalEmissive = mat.emissiveIntensity
                mat.emissiveIntensity = 0.5
                mat.emissive.setHex(0xff0000)

                setTimeout(() => {
                    if (mat) {
                        mat.emissiveIntensity = originalEmissive
                        mat.emissive.setHex(0x808080)
                    }
                }, 100)
            }
        })
    }

    _die(attacker = null) {
        this._isAlive = false
        console.log('[Barricade] Destroyed!')

        // Remove physics body immediately so enemies can pass
        this._removePhysicsBody()

        // Visual feedback - fade out and remove
        if (this.object) {
            this.object.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true
                    child.material.opacity = 0.5
                }
            })

            // Remove after short delay
            setTimeout(() => {
                if (this.object && this.object.parent) {
                    this.object.removeFromParent()
                    this.object.traverse((child) => {
                        if (child.isMesh) {
                            child.geometry?.dispose()
                            child.material?.dispose()
                        }
                    })
                }
            }, 500)
        }
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        if (!this.object || !this._isAlive) return false

        this._updateHealthBar(deltaTime)

        return true
    }

    // ==================== UI CONFIG ====================

    TestDamage = () => {
        this.takeDamage(100)
    }

    ResetHealth = () => {
        this.health = this.maxHealth
        this._displayedHealth = this.health
        this._isAlive = true
    }

    uiConfig = {
        type: 'folder',
        label: 'Barricade',
        children: [
            {
                type: 'button',
                label: 'Test Damage (100)',
                onClick: this.TestDamage,
            },
            {
                type: 'button',
                label: 'Reset Health',
                onClick: this.ResetHealth,
            },
        ],
    }
}
