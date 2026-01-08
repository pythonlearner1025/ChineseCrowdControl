import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import {CollisionSystem} from './CollisionSystem.js'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * PlayerController - WASD movement controller for the player character
 */
export class PlayerController extends Object3DComponent {
    static StateProperties = [
        'running', 'speed', 'health', 'maxHealth', 'armor',
        'attackRange', 'damage', 'attackFrequency', 'invulnerabilityTime',
        'mass', 'friction', 'healthRegen', 'modelScale'
    ]
    static ComponentType = 'PlayerController'

    running = true
    speed = 10 // units per second (max speed)

    // Combat attributes
    health = 100
    maxHealth = 100
    armor = 1
    attackRange = 20      // ranged attack distance
    damage = 0
    attackFrequency = 2   // attacks per second
    invulnerabilityTime = 0.5 // seconds of invulnerability after being hit
    healthRegen = 0.10    // 10% of max health per second

    // Physics attributes
    mass = 0.5            // low mass = snappy direction changes
    friction = 20         // high friction = sharp turns, minimal drift

    // Model settings
    modelScale = 0.01     // FBX models are often large, scale down

    // Cannon-es physics integration
    _physicsBody = null   // CANNON.Body
    _physicsWorld = null  // Cannon-es world reference

    // Internal combat state
    _isAlive = true
    _lastDamageTime = 0

    // Collision damage settings
    collisionRadius = 1.2         // how close entities must be to deal collision damage
    collisionDamageCooldown = 0 // ms between collision damage from same source
    _collisionCooldowns = null    // Map of entity -> last damage time

    // Physics state
    _velocity = null      // THREE.Vector3
    _displayedHealth = 100 // for smooth health bar animation

    // Health bar
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null

    // Animation
    _mixer = null           // THREE.AnimationMixer
    _walkAction = null      // Walking animation action
    _loadedModel = null     // Reference to loaded model
    _isWalking = false      // Track if currently walking
    _originalMaterial = null // Store original material for cleanup

    // Internal movement state
    keys = {
        w: false,
        a: false,
        s: false,
        d: false
    }

    async start() {
        if (super.start) super.start()
        this._handleKeyDown = this._handleKeyDown.bind(this)
        this._handleKeyUp = this._handleKeyUp.bind(this)
        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('keyup', this._handleKeyUp)

        // Initialize physics
        this._velocity = new THREE.Vector3(0, 0, 0)
        this._displayedHealth = this.health

        // Initialize collision cooldowns
        this._collisionCooldowns = new Map()

        // Create health bar
        this._createHealthBar()

        // Load the player model and animation
        await this._loadPlayerModel()

        // Create cannon-es physics body
        this._initializeCannonPhysics()
    }

    async _loadPlayerModel() {
        const viewer = this.ctx?.viewer
        if (!viewer) {
            console.error('[PlayerController] No viewer found')
            return
        }

        try {
            // Hide original mesh - just make the material transparent or hide the mesh itself
            if (this.object.isMesh && this.object.material) {
                this._originalMaterial = this.object.material
                this.object.material = new THREE.MeshBasicMaterial({ visible: false })
            }

            console.log('[PlayerController] Loading police model...')

            // Use import() to load without auto-adding to scene
            const model = await viewer.import('/kite/assets/models/police_model.fbx')
            if (!model) {
                console.error('[PlayerController] Failed to load police model')
                return
            }

            console.log('[PlayerController] Model loaded:', model)

            // Remove from scene if viewer.import added it
            if (model.parent) {
                model.parent.remove(model)
            }

            // Keep original FBX materials (textures are embedded in the FBX file)
            model.traverse((child) => {
                if (child.isMesh || child.isSkinnedMesh) {
                    child.castShadow = true
                    child.receiveShadow = true
                }
            })

            // Scale and position the model
            model.scale.setScalar(this.modelScale)
            model.position.set(0, -0.5, 0) // Offset to ground level

            // Add model as child of player object
            this._loadedModel = model
            this.object.add(model)

            console.log('[PlayerController] Model added to player, loading animation...')

            // Load walking animation
            const walkAnimData = await viewer.import('/kite/assets/models/walking_animation.fbx')
            console.log('[PlayerController] Animation data loaded:', walkAnimData)

            if (walkAnimData) {
                // Remove from scene if added
                if (walkAnimData.parent) {
                    walkAnimData.parent.remove(walkAnimData)
                }

                // Check for animations on the loaded object or its root
                const animations = walkAnimData.animations || []
                console.log('[PlayerController] Found animations:', animations.length)

                if (animations.length > 0) {
                    // Create mixer on the loaded model
                    this._mixer = new THREE.AnimationMixer(model)

                    // Get the first animation clip
                    const walkClip = animations[0]
                    this._walkAction = this._mixer.clipAction(walkClip)
                    this._walkAction.setLoop(THREE.LoopRepeat)

                    console.log('[PlayerController] Model and walking animation loaded successfully')
                } else {
                    console.warn('[PlayerController] No animations found in walking_animation.fbx')
                }
            }

        } catch (error) {
            console.error('[PlayerController] Error loading model:', error)
        }
    }

    _initializeCannonPhysics() {
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager) {
            console.error('[PlayerController] No PhysicsWorldManager found!')
            return
        }
        this._physicsWorld = physicsManager.world

        // Create dynamic physics body for player
        this._physicsBody = CollisionSystem.getOrCreateBody(
            this.object,
            this,
            this._physicsWorld,
            {
                bodyType: 'dynamic',  // Fully physics-controlled
                shapeType: 'box',
                shapeSize: { width:1, height: 1, depth: 1  },
                mass: this.mass,
                friction: 0.8,
                restitution: 0.3,
                linearDamping: 0.8
            }
        )

        //console.log('[PlayerController] Cannon-es physics body created with mass:', this.mass)
    }

    stop() {
        if (super.stop) super.stop()
        window.removeEventListener('keydown', this._handleKeyDown)
        window.removeEventListener('keyup', this._handleKeyUp)

        // Cleanup health bar
        this._removeHealthBar()

        // Cleanup animation
        if (this._mixer) {
            this._mixer.stopAllAction()
            this._mixer = null
        }
        this._walkAction = null

        // Cleanup loaded model
        if (this._loadedModel) {
            this.object.remove(this._loadedModel)
            this._loadedModel.traverse((child) => {
                if (child.geometry) child.geometry.dispose()
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose())
                    } else {
                        child.material.dispose()
                    }
                }
            })
            this._loadedModel = null
        }

        // Restore original material
        if (this._originalMaterial && this.object.isMesh) {
            this.object.material = this._originalMaterial
            this._originalMaterial = null
        }

        // Cleanup cannon-es physics body
        if (this._physicsBody && this._physicsWorld) {
            CollisionSystem.removeBody(this.object, this._physicsWorld)
            this._physicsBody = null
        }
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

    update(params) {
        try {
            if (!this.object) return false

            const deltaTime = params?.deltaTime || params?.delta || 16
            const dt = deltaTime / 1000

            // Always update health bar
            this._updateHealthBar(deltaTime)

            // Health regeneration
            if (this.isAlive && this.health < this.maxHealth) {
                const regenAmount = this.maxHealth * this.healthRegen * dt
                this.health = Math.min(this.maxHealth, this.health + regenAmount)
            }

            if (!this.running || !this.isAlive) {
                // Still update animation mixer when paused
                if (this._mixer) {
                    this._mixer.update(dt)
                }
                // Still sync physics when not running (apply friction)
                if (this._physicsBody) {
                    CollisionSystem.syncObjectToBody(this.object, this, this._physicsBody)
                }
                return (this._velocity && this._velocity.lengthSq() > 0.001)
            }

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

            // Update animation mixer
            if (this._mixer) {
                this._mixer.update(dt)
            }

            // Handle walking animation play/stop
            const isMoving = inputMag > 0
            if (this._walkAction) {
                if (isMoving && !this._isWalking) {
                    this._walkAction.reset()
                    this._walkAction.play()
                    this._isWalking = true
                } else if (!isMoving && this._isWalking) {
                    this._walkAction.fadeOut(0.2)
                    this._isWalking = false
                }
            }

            // Rotate model to face movement direction
            if (isMoving && this._loadedModel) {
                const targetAngle = Math.atan2(inputX, inputZ)
                this._loadedModel.rotation.y = targetAngle
            }

            // === CANNON-ES PHYSICS MODE ===
            if (this._physicsBody) {
                // Sync TO body (prepare input)
                CollisionSystem.syncObjectToBody(this.object, this, this._physicsBody)

                // Apply movement force (cannon-es will integrate this)
                const acceleration = this.speed
                CollisionSystem.applyMovementForce(this._physicsBody, inputX, inputZ, acceleration, true)

                // Sync FROM body (read physics results from previous frame)
                // Note: This reads results from the last world.step(), which is fine
                CollisionSystem.syncBodyToObject(this.object, this, this._physicsBody)
            } else {
                // Fallback: legacy physics (shouldn't happen)
                console.warn('[PlayerController] No physics body! Using legacy physics.')
                this._applyPhysics(dt, inputX, inputZ)
            }

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
    // NOTE: Collision damage is now handled automatically by CollisionSystem via cannon-es events
    // No manual collision checks needed!

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
