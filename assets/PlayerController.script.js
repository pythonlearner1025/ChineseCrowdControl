import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * WASD movement controller for player objects with combat attributes
 */
export class PlayerController extends Object3DComponent {
    static StateProperties = [
        'running', 'speed', 'health', 'maxHealth', 'armor',
        'attackRange', 'damage', 'attackFrequency', 'invulnerabilityTime',
        'projectileSpeed', 'projectileSize', 'projectileColor',
        'autoFire', 'homingStrength', 'mass', 'friction', 'healthRegen'
    ]
    static ComponentType = 'PlayerController'

    running = true
    speed = 10 // units per second (max speed)

    // Combat attributes
    health = 50
    maxHealth = 100
    armor = 1
    attackRange = 20      // ranged attack distance
    damage = 25
    attackFrequency = 2   // attacks per second
    invulnerabilityTime = 0.5 // seconds of invulnerability after being hit
    healthRegen = 0.10    // 10% of max health per second

    // Projectile attributes
    projectileSpeed = 15  // units per second
    projectileSize = 0.2  // radius of the ball
    projectileColor = 0xffcc00 // golden yellow
    autoFire = true       // automatically fire at enemies in range
    homingStrength = 5    // how aggressively projectiles track (radians/sec turn rate)

    // Physics attributes
    mass = 0.5            // low mass = snappy direction changes
    friction = 20         // high friction = sharp turns, minimal drift

    // Internal combat state
    _isAlive = true
    _lastDamageTime = 0
    _lastAttackTime = 0
    _projectiles = []     // active projectiles in flight
    _raycaster = null
    _mouse = null
    _cachedEnemies = []   // cached list of enemies for targeting
    
    // Collision damage settings
    collisionRadius = 1.2         // how close entities must be to deal collision damage
    collisionDamageCooldown = 300 // ms between collision damage from same source
    _collisionCooldowns = null    // Map of entity -> last damage time

    // Physics state
    _velocity = null      // THREE.Vector3
    _displayedHealth = 100 // for smooth health bar animation

    // Health bar
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null

    // Internal movement state
    keys = {
        w: false,
        a: false,
        s: false,
        d: false
    }

    start() {
        if (super.start) super.start()
        this._handleKeyDown = this._handleKeyDown.bind(this)
        this._handleKeyUp = this._handleKeyUp.bind(this)
        this._handleMouseDown = this._handleMouseDown.bind(this)
        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('keyup', this._handleKeyUp)
        window.addEventListener('mousedown', this._handleMouseDown)

        // Setup raycaster for aiming
        this._raycaster = new THREE.Raycaster()
        this._mouse = new THREE.Vector2()
        this._projectiles = []

        // Initialize physics
        this._velocity = new THREE.Vector3(0, 0, 0)
        this._displayedHealth = this.health
        
        // Initialize collision cooldowns
        this._collisionCooldowns = new Map()

        // Create health bar
        this._createHealthBar()
    }

    stop() {
        if (super.stop) super.stop()
        window.removeEventListener('keydown', this._handleKeyDown)
        window.removeEventListener('keyup', this._handleKeyUp)
        window.removeEventListener('mousedown', this._handleMouseDown)

        // Cleanup projectiles
        this._cleanupAllProjectiles()

        // Cleanup health bar
        this._removeHealthBar()
    }

    // ==================== HEALTH BAR ====================

    _createHealthBar() {
        if (!this.object) return

        const barWidth = 1.2
        const barHeight = 0.3
        const barOffset = 2.8 // height above object

        // Create group to hold health bar components
        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'HealthBar'

        // Background bar (dark)
        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        })
        this._healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        this._healthBarGroup.add(this._healthBarBg)

        // Health fill bar (green)
        const fillGeometry = new THREE.PlaneGeometry(barWidth - 0.06, barHeight - 0.08)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            side: THREE.DoubleSide
        })
        this._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this._healthBarFill.position.z = 0.01 // slightly in front
        this._healthBarGroup.add(this._healthBarFill)

        // Position above player
        this._healthBarGroup.position.y = barOffset

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
        const healthLerpSpeed = 5 // how fast health bar animates
        const dt = deltaTime / 1000
        this._displayedHealth += (this.health - this._displayedHealth) * Math.min(1, healthLerpSpeed * dt)

        // Update fill scale (0 to 1)
        const healthPercent = Math.max(0, this._displayedHealth / this.maxHealth)
        this._healthBarFill.scale.x = healthPercent

        // Offset to keep bar left-aligned
        const barWidth = 1.16 // fillGeometry width
        this._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Color gradient: green -> yellow -> red
        const color = new THREE.Color()
        if (healthPercent > 0.5) {
            color.setRGB(
                (1 - healthPercent) * 2, // 0 to 1
                1,
                0.2
            )
        } else {
            color.setRGB(
                1,
                healthPercent * 2, // 1 to 0
                0.1
            )
        }
        this._healthBarFill.material.color = color

        // Billboard: face camera (compensate for parent rotation)
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera && this.object) {
            // Get camera world position
            const cameraWorldPos = new THREE.Vector3()
            camera.getWorldPosition(cameraWorldPos)

            // Get health bar world position
            const barWorldPos = new THREE.Vector3()
            this._healthBarGroup.getWorldPosition(barWorldPos)

            // Make health bar look at camera
            this._healthBarGroup.lookAt(cameraWorldPos)
        }
    }

    _cleanupAllProjectiles() {
        const scene = this.ctx?.viewer?.scene
        if (scene) {
            for (const proj of this._projectiles) {
                scene.remove(proj.mesh)
                proj.mesh.geometry.dispose()
                proj.mesh.material.dispose()
            }
        }
        this._projectiles = []
    }

    _handleKeyDown(event) {
        const key = event.key.toLowerCase()
        if (key in this.keys) {
            this.keys[key] = true
        }
    }

    _handleKeyUp(event) {
        const key = event.key.toLowerCase()
        if (key in this.keys) {
            this.keys[key] = false
        }
    }

    _handleMouseDown(event) {
        // Only fire on left click
        if (event.button !== 0) return
        if (!this.isAlive || !this.running) return

        // Check attack cooldown
        const now = Date.now()
        const cooldown = 1000 / this.attackFrequency
        if (now - this._lastAttackTime < cooldown) return

        this._lastAttackTime = now
        this._fireProjectileManual(event)
    }

    // ==================== TARGETING ====================

    _findEnemiesInRange() {
        const viewer = this.ctx?.viewer
        if (!viewer || !this.object) return []

        const enemies = []
        const myPos = this.object.position

        viewer.scene.traverse((obj) => {
            if (obj === this.object) return

            const enemyController = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController') ||
                                    EntityComponentPlugin.GetComponent(obj, 'GoliathController')

            if (enemyController && enemyController.isAlive) {
                const dist = myPos.distanceTo(obj.position)
                if (dist <= this.attackRange) {
                    enemies.push({ object: obj, controller: enemyController, distance: dist })
                }
            }
        })

        // Sort by distance (closest first)
        enemies.sort((a, b) => a.distance - b.distance)
        return enemies
    }

    _findClosestEnemy() {
        const enemies = this._findEnemiesInRange()
        return enemies.length > 0 ? enemies[0] : null
    }

    // ==================== PROJECTILE FIRING ====================

    _fireProjectileManual(event) {
        const viewer = this.ctx?.viewer
        if (!viewer) return

        const camera = viewer.scene.mainCamera
        if (!camera) return

        // Get mouse position in normalized device coordinates
        const rect = viewer.container.getBoundingClientRect()
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        // Cast ray from camera through mouse position
        this._raycaster.setFromCamera(this._mouse, camera)

        // Calculate direction to shoot (use ray direction)
        const direction = this._raycaster.ray.direction.clone().normalize()

        // Find closest enemy for homing target
        const closestEnemy = this._findClosestEnemy()

        this._createProjectile(direction, closestEnemy?.object || null)
    }

    _fireProjectileAtTarget(targetObj) {
        if (!this.object || !targetObj) return

        // Calculate direction from player to target
        const startPos = this.object.position.clone()
        startPos.y += 1

        const targetPos = targetObj.position.clone()
        targetPos.y += 1 // aim at chest height

        const direction = new THREE.Vector3()
            .subVectors(targetPos, startPos)
            .normalize()

        this._createProjectile(direction, targetObj)
    }

    _createProjectile(direction, target = null) {
        const viewer = this.ctx?.viewer
        if (!viewer) return

        // Create projectile starting from player position
        const startPos = this.object.position.clone()
        startPos.y += 1 // offset up a bit (shoot from chest height)

        // Create projectile mesh
        const geometry = new THREE.SphereGeometry(this.projectileSize, 16, 16)
        const material = new THREE.MeshStandardMaterial({
            color: this.projectileColor,
            emissive: this.projectileColor,
            emissiveIntensity: 0.5,
            metalness: 0.3,
            roughness: 0.4
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.copy(startPos)
        mesh.name = 'Projectile'

        // Add to scene
        viewer.scene.add(mesh)

        // Store projectile data with homing target
        this._projectiles.push({
            mesh,
            direction: direction.clone(),
            distanceTraveled: 0,
            startPos: startPos.clone(),
            target // homing target (can be null)
        })
    }

    _tryAutoFire() {
        if (!this.autoFire || !this.isAlive || !this.running) return

        const now = Date.now()
        const cooldown = 1000 / this.attackFrequency
        if (now - this._lastAttackTime < cooldown) return // still on cooldown

        // Find closest enemy in range
        const closestEnemy = this._findClosestEnemy()
        if (!closestEnemy) {
            return
        }

        this._lastAttackTime = now
        this._fireProjectileAtTarget(closestEnemy.object)
    }

    _updateProjectiles(deltaTime) {
        const viewer = this.ctx?.viewer
        if (!viewer) return

        const scene = viewer.scene
        const moveAmount = this.projectileSpeed * (deltaTime / 1000)
        const dt = deltaTime / 1000

        // Process each projectile
        for (let i = this._projectiles.length - 1; i >= 0; i--) {
            const proj = this._projectiles[i]

            // Apply homing if target exists and is alive
            this._applyHoming(proj, dt)

            // Move projectile
            proj.mesh.position.x += proj.direction.x * moveAmount
            proj.mesh.position.y += proj.direction.y * moveAmount
            proj.mesh.position.z += proj.direction.z * moveAmount
            proj.distanceTraveled += moveAmount

            // Check if out of range
            if (proj.distanceTraveled >= this.attackRange) {
                this._removeProjectile(i, scene)
                continue
            }

            // Check for enemy collision
            const hit = this._checkProjectileHit(proj)
            if (hit) {
                this._onProjectileHit(hit, proj)
                this._removeProjectile(i, scene)
            }
        }
    }

    _applyHoming(proj, dt) {
        // Check if target is valid
        if (!proj.target) return

        const targetController = EntityComponentPlugin.GetComponent(proj.target, 'BaseEnemyController') ||
                                  EntityComponentPlugin.GetComponent(proj.target, 'GoliathController')

        // If target is dead, try to find a new one
        if (!targetController || !targetController.isAlive) {
            const newTarget = this._findClosestEnemy()
            proj.target = newTarget?.object || null
            if (!proj.target) return
        }

        // Calculate desired direction to target
        const projPos = proj.mesh.position
        const targetPos = proj.target.position.clone()
        targetPos.y += 1 // aim at chest height

        const desiredDir = new THREE.Vector3()
            .subVectors(targetPos, projPos)
            .normalize()

        // Smoothly rotate current direction towards desired direction
        // Using spherical interpolation for smooth turning
        const maxTurnAngle = this.homingStrength * dt

        // Calculate angle between current and desired direction
        const dot = proj.direction.dot(desiredDir)
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)))

        if (angle > 0.001) {
            // Clamp turn rate
            const turnFraction = Math.min(1, maxTurnAngle / angle)

            // Interpolate direction
            proj.direction.lerp(desiredDir, turnFraction).normalize()
        }
    }

    _checkProjectileHit(proj) {
        const viewer = this.ctx?.viewer
        if (!viewer) return null

        const projPos = proj.mesh.position
        const hitRadius = this.projectileSize + 0.5 // projectile + enemy radius

        // Find all enemies and check distance
        let closestHit = null
        let closestDist = Infinity

        viewer.scene.traverse((obj) => {
            if (obj === this.object) return // skip self
            if (obj === proj.mesh) return   // skip projectile itself

            // Check if this object has an enemy controller
            const enemyController = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController') ||
                                    EntityComponentPlugin.GetComponent(obj, 'GoliathController')

            if (enemyController && enemyController.isAlive) {
                const dist = projPos.distanceTo(obj.position)
                if (dist < hitRadius && dist < closestDist) {
                    closestDist = dist
                    closestHit = { object: obj, controller: enemyController }
                }
            }
        })

        return closestHit
    }

    _onProjectileHit(hit, proj) {
        // Deal damage to enemy
        if (typeof hit.controller.takeDamage === 'function') {
            hit.controller.takeDamage(this.damage, this)
        }

        // Visual feedback - brief flash
        this._createHitEffect(proj.mesh.position)
    }

    _createHitEffect(position) {
        const viewer = this.ctx?.viewer
        if (!viewer) return

        // Create expanding ring effect
        const geometry = new THREE.RingGeometry(0.1, 0.3, 16)
        const material = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide
        })
        const ring = new THREE.Mesh(geometry, material)
        ring.position.copy(position)
        ring.rotation.x = -Math.PI / 2 // lay flat

        viewer.scene.add(ring)

        // Animate expansion and fade
        const startTime = Date.now()
        const duration = 300

        const animate = () => {
            const elapsed = Date.now() - startTime
            const t = elapsed / duration

            if (t >= 1) {
                viewer.scene.remove(ring)
                geometry.dispose()
                material.dispose()
                return
            }

            ring.scale.setScalar(1 + t * 3)
            material.opacity = 1 - t

            requestAnimationFrame(animate)
        }
        animate()
    }

    _removeProjectile(index, scene) {
        const proj = this._projectiles[index]
        scene.remove(proj.mesh)
        proj.mesh.geometry.dispose()
        proj.mesh.material.dispose()
        this._projectiles.splice(index, 1)
    }

    update(params) {
        try {
            if (!this.object) return false

            const deltaTime = params?.deltaTime || params?.delta || 16
            const dt = deltaTime / 1000

            // Always update projectiles even if not running
            this._updateProjectiles(deltaTime)

            // Always update health bar
            this._updateHealthBar(deltaTime)

            // Health regeneration
            if (this.isAlive && this.health < this.maxHealth) {
                const regenAmount = this.maxHealth * this.healthRegen * dt
                this.health = Math.min(this.maxHealth, this.health + regenAmount)
            }

            if (!this.running || !this.isAlive) {
                // Still apply friction when not running
                this._applyPhysics(dt, 0, 0)
                return this._projectiles.length > 0 || this._velocity.lengthSq() > 0.001
            }

            // Check for collision damage from entities
            this._checkEntityCollisions()

            // Auto-fire at enemies in range
            this._tryAutoFire()

            // Calculate desired movement direction
            let inputX = 0
            let inputZ = 0

            // W = forward (negative Z)
            if (this.keys.w) inputZ -= 1
            // S = backward (positive Z)
            if (this.keys.s) inputZ += 1
            // A = left (negative X)
            if (this.keys.a) inputX -= 1
            // D = right (positive X)
            if (this.keys.d) inputX += 1

            // Normalize input
            const inputMag = Math.sqrt(inputX * inputX + inputZ * inputZ)
            if (inputMag > 0) {
                inputX /= inputMag
                inputZ /= inputMag
            }

            // Apply physics-based movement
            this._applyPhysics(dt, inputX, inputZ)

            return true
        } catch (error) {
            return false
        }
    }

    _applyPhysics(dt, inputX, inputZ) {
        if (!this._velocity) {
            this._velocity = new THREE.Vector3(0, 0, 0)
        }

        // Calculate acceleration based on input and mass
        // F = ma, so a = F/m. Force is our input * speed factor
        const acceleration = this.speed * 2 / this.mass

        // Apply input force
        if (inputX !== 0 || inputZ !== 0) {
            this._velocity.x += inputX * acceleration * dt
            this._velocity.z += inputZ * acceleration * dt
        }

        // Apply friction (drag force proportional to velocity)
        // F_friction = -friction * velocity
        const frictionFactor = Math.exp(-this.friction * dt)
        this._velocity.x *= frictionFactor
        this._velocity.z *= frictionFactor

        // Clamp to max speed
        const currentSpeed = Math.sqrt(this._velocity.x ** 2 + this._velocity.z ** 2)
        if (currentSpeed > this.speed) {
            const scale = this.speed / currentSpeed
            this._velocity.x *= scale
            this._velocity.z *= scale
        }

        // Apply velocity to position
        this.object.position.x += this._velocity.x * dt
        this.object.position.z += this._velocity.z * dt

        // Stop if very slow (prevent drift)
        if (currentSpeed < 0.01) {
            this._velocity.x = 0
            this._velocity.z = 0
        }
    }

    // ==================== COLLISION DAMAGE ====================

    _checkEntityCollisions() {
        if (!this.isAlive || !this.object) return
        
        const viewer = this.ctx?.viewer
        if (!viewer) return
        
        const myPos = this.object.position
        const now = Date.now()
        
        // Check all objects in scene for collision
        viewer.scene.traverse((obj) => {
            if (obj === this.object) return
            
            // Check for soldiers
            const soldier = EntityComponentPlugin.GetComponent(obj, 'SoldierController')
            if (soldier && soldier.isAlive) {
                this._handleEntityCollision(obj, soldier, myPos, now, soldier.damage || 5)
                return
            }
            
            // Check for base enemies
            const enemy = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController') ||
                          EntityComponentPlugin.GetComponent(obj, 'GoliathController')
            if (enemy && enemy.isAlive) {
                this._handleEntityCollision(obj, enemy, myPos, now, enemy.damage || 10)
                return
            }
            
            // Check for CrowdController to get crowd members
            const crowdController = EntityComponentPlugin.GetComponent(obj, 'CrowdController')
            if (crowdController && crowdController._members) {
                for (const member of crowdController._members) {
                    if (!member || !member.isAlive || !member.mesh) continue
                    this._handleCrowdMemberCollision(member, myPos, now)
                }
            }
        })
    }
    
    _handleEntityCollision(obj, entity, myPos, now, damage) {
        const dist = myPos.distanceTo(obj.position)
        
        if (dist < this.collisionRadius) {
            // Check cooldown
            const lastHit = this._collisionCooldowns.get(entity) || 0
            if (now - lastHit < this.collisionDamageCooldown) return
            
            this._collisionCooldowns.set(entity, now)
            this.takeDamage(damage, entity)
        }
    }
    
    _handleCrowdMemberCollision(member, myPos, now) {
        const dist = myPos.distanceTo(member.mesh.position)
        
        if (dist < this.collisionRadius) {
            // Check cooldown
            const lastHit = this._collisionCooldowns.get(member) || 0
            if (now - lastHit < this.collisionDamageCooldown) return
            
            this._collisionCooldowns.set(member, now)
            this.takeDamage(member.damage || 5, member)
        }
    }

    // ==================== COMBAT ====================

    get isAlive() {
        return this._isAlive && this.health > 0
    }

    get isInvulnerable() {
        const now = Date.now()
        return (now - this._lastDamageTime) < (this.invulnerabilityTime * 1000)
    }

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return
        if (this.isInvulnerable) {
            return
        }

        // Apply armor reduction
        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage
        this._lastDamageTime = Date.now()

        if (this.health <= 0) {
            this._die(attacker)
        }
    }

    heal(amount) {
        if (!this.isAlive) return

        const oldHealth = this.health
        this.health = Math.min(this.maxHealth, this.health + amount)
        const actualHeal = this.health - oldHealth
    }

    _die(attacker = null) {
        this._isAlive = false
        this.running = false
        this.onDeath(attacker)
    }

    onDeath(attacker = null) {
        // Hide player first (ensure death happens)
        if (this.object) {
            this.object.visible = false
        }

        // Try to spawn ragdoll (non-blocking)
        try {
            const worldPos = new THREE.Vector3()
            this.object.getWorldPosition(worldPos)

            // Calculate impact velocity from attacker
            let impactVelocity = new THREE.Vector3()
            if (attacker) {
                // Try to get attacker position
                let attackerPos = null
                if (attacker.object) {
                    attackerPos = new THREE.Vector3()
                    attacker.object.getWorldPosition(attackerPos)
                } else if (attacker.mesh) {
                    attackerPos = attacker.mesh.position.clone()
                }

                if (attackerPos) {
                    impactVelocity.subVectors(worldPos, attackerPos).normalize()
                    impactVelocity.multiplyScalar(30) // Strong impact force
                    impactVelocity.y = 10 // Add upward component
                }
            } else if (this._velocity) {
                impactVelocity = this._velocity.clone()
            }

            this._spawnRagdoll(worldPos, impactVelocity)
        } catch (error) {
            console.error('[PlayerController] Error spawning ragdoll:', error)
        }
    }

    _spawnRagdoll(position, velocity) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.warn('[PlayerController] No scene found for ragdoll')
            return
        }

        if (!this.ctx?.ecp) {
            console.warn('[PlayerController] ECP not available for ragdoll')
            return
        }

        // Create a temporary object for the ragdoll component
        const ragdollObj = new THREE.Group()
        ragdollObj.position.copy(position)
        scene.add(ragdollObj)

        // Add ragdoll component using ECP
        this.ctx.ecp.addComponent(ragdollObj, 'RagdollComponent')

        // Get the component
        const ragdoll = EntityComponentPlugin.GetComponent(ragdollObj, 'RagdollComponent')

        if (ragdoll) {
            //console.log('[PlayerController] Spawning player ragdoll at', position)
            // Spawn ragdoll with green color for player
            ragdoll.spawnRagdoll(position, velocity, {
                scale: 1.0,
                color: 0x44ff44, // Green for player
                enemyType: 'Player'
            })
        } else {
            console.warn('[PlayerController] Failed to get RagdollComponent')
        }
    }

    respawn() {
        this._isAlive = true
        this.health = this.maxHealth
        this.running = true
        this._lastDamageTime = 0

        // Make player visible again
        if (this.object) {
            this.object.visible = true
        }
    }
    
    ToggleRunning = () => {
        this.running = !this.running
    }
    
    uiConfig = {
        type: 'folder',
        label: 'Player Controller',
        children: [
            {
                type: 'button',
                label: 'Toggle Running',
                onClick: this.ToggleRunning,
            },
            {
                type: 'button',
                label: 'Respawn',
                onClick: () => this.respawn(),
            },
        ],
    }
}