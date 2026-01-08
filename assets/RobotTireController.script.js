import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'
import {CollisionSystem} from './CollisionSystem.js'

/**
 * RobotTireController - Individual soldier with selection and movement commands
 */
export class RobotTireController extends Object3DComponent {
    static StateProperties = [
       'enabled', 'health', 'maxHealth', 'armor', 'damage',
       'detectionRange', 'attackRange'
    ]
    static ComponentType = 'RobotTireController'

    // Component enabled flag (required for update loop)
    enabled = true

    // Core attributes
    baseSpeed = 3000        // max speed
    health = 10000
    maxHealth = 10000
    armor = 2
    damage = 50         // base damage on impact
    impactDamageScale = 0.10  // damage multiplier per unit of speed

    // Auto-attack attributes
    detectionRange = 25  // how far they can detect enemies
    attackRange = 2      // melee range

    // Selection state
    _isSelected = false
    _groupId = null // e.g., 1, 2, 3...

    // Movement state
    _targetPosition = null
    _userTargetPosition = null  // user-commanded target (takes priority)
    _velocity = null
    _isMoving = false
    _autoTargetEnemy = null  // current auto-attack target

    // Visuals
    _selectionRing = null
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null
    _displayedHealth = 50

    // Physics
    mass = 10.0          // heavier = more momentum
    friction = 6        // higher = stops faster, less gliding
    acceleration = 500  // how fast they accelerate

    // Impact tracking
    _impactCooldowns = new Map()  // enemy -> last impact time
    _impactCooldownMs = 500       // ms between impacts on same enemy

    get isAlive() {
        return this.health > 0
    }

    get isSelected() {
        return this._isSelected
    }

    get groupId() {
        return this._groupId
    }

    start() {
        //console.log('start', this.baseSpeed)
        if (super.start) super.start()
        //console.log('[RobotTireController] Soldier spawned')

        this._velocity = new THREE.Vector3(0, 0, 0)
        this._displayedHealth = this.health
        this._impactCooldowns = new Map()
        
        this._createSelectionRing()
        this._createHealthBar()
        
        // Register with manager
        this._registerWithManager()

        // Register physics body with CollisionSystem
        const physicsManager = getPhysicsWorldManager()
        if (physicsManager && physicsManager.world) {
            //console.log('[RobotTireController] Registering physics body for', this.object.name)
            this._physicsBody = CollisionSystem.getOrCreateBody(
                this.object,
                this,
                physicsManager.world,
                {
                    bodyType: 'dynamic',  // Fully physics-controlled
                    shapeType: 'box',
                    shapeSize: { width:1, height: 1, depth: 1 },
                    mass: this.mass,
                    friction: this.friction / 10, // Convert to cannon-es scale
                    restitution: 0.3,
                    linearDamping: 0.3,
                    angularDamping: 0.3
                }
            )
        } else {
            console.warn('[RobotTireController] Physics manager not available!', {
                hasManager: !!physicsManager,
                hasWorld: physicsManager ? !!physicsManager.world : false
            })
        }

        // Trigger update loop
        this.ctx?.viewer?.setDirty()
    }

    stop() {
        if (super.stop) super.stop()

        // Remove physics body
        const physicsManager = getPhysicsWorldManager()
        if (physicsManager && physicsManager.world && this._physicsBody) {
            //console.log('[RobotTireController] Removing physics body for', this.object.name)
            CollisionSystem.removeBody(this.object, physicsManager.world)
            this._physicsBody = null
        }

        this._removeSelectionRing()
        this._removeHealthBar()
        this._unregisterFromManager()
        this._impactCooldowns?.clear()
    }

    _registerWithManager() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return
        
        scene.traverse((obj) => {
            const manager = EntityComponentPlugin.GetComponent(obj, 'SoldierSelectionManager')
            if (manager) {
                manager.registerSoldier(this)
            }
        })
    }

    _unregisterFromManager() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return
        
        scene.traverse((obj) => {
            const manager = EntityComponentPlugin.GetComponent(obj, 'SoldierSelectionManager')
            if (manager) {
                manager.unregisterSoldier(this)
            }
        })
    }

    // ==================== SELECTION ====================

    select() {
        this._isSelected = true
        this._updateSelectionVisual()
        //console.log('[RobotTireController] Selected')
    }

    deselect() {
        this._isSelected = false
        this._updateSelectionVisual()
        //console.log('[RobotTireController] Deselected')
    }

    setGroup(groupId) {
        this._groupId = groupId
        //console.log(`[RobotTireController] Assigned to group ${groupId}`)
    }

    clearGroup() {
        this._groupId = null
    }

    // ==================== SELECTION RING ====================

    _createSelectionRing() {
        if (!this.object) return

        const geometry = new THREE.RingGeometry(0.6, 0.8, 32)
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        })
        this._selectionRing = new THREE.Mesh(geometry, material)
        this._selectionRing.rotation.x = -Math.PI / 2 // lay flat
        this._selectionRing.position.y = 0.05 // slightly above ground
        this._selectionRing.visible = false
        
        this.object.add(this._selectionRing)
    }

    _removeSelectionRing() {
        if (this._selectionRing && this.object) {
            this.object.remove(this._selectionRing)
            this._selectionRing.geometry.dispose()
            this._selectionRing.material.dispose()
        }
        this._selectionRing = null
    }

    _updateSelectionVisual() {
        if (!this._selectionRing) return
        
        this._selectionRing.visible = this._isSelected
        
        // Color based on group
        if (this._groupId !== null) {
            const colors = [0x00ff00, 0xff6600, 0x0066ff, 0xff00ff, 0xffff00]
            const color = colors[(this._groupId - 1) % colors.length]
            this._selectionRing.material.color.setHex(color)
        } else {
            this._selectionRing.material.color.setHex(0x00ff00)
        }
    }

    // ==================== HEALTH BAR ====================

    _createHealthBar() {
        if (!this.object) return

        const barWidth = 0.8
        const barHeight = 0.15

        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'SoldierHealthBar'

        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7
        })
        this._healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        this._healthBarGroup.add(this._healthBarBg)

        const fillGeometry = new THREE.PlaneGeometry(barWidth - 0.04, barHeight - 0.04)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            side: THREE.DoubleSide
        })
        this._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this._healthBarFill.position.z = 0.01
        this._healthBarGroup.add(this._healthBarFill)

        this._healthBarGroup.position.y = 2.0

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

        const dt = deltaTime / 1000
        this._displayedHealth += (this.health - this._displayedHealth) * Math.min(1, 5 * dt)

        const healthPercent = Math.max(0, this._displayedHealth / this.maxHealth)
        this._healthBarFill.scale.x = healthPercent

        const barWidth = 0.76
        this._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Billboard
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera && this.object) {
            const cameraWorldPos = new THREE.Vector3()
            camera.getWorldPosition(cameraWorldPos)
            this._healthBarGroup.lookAt(cameraWorldPos)
        }
    }

    // ==================== MOVEMENT ====================

    moveTo(position) {
        this._userTargetPosition = position.clone()
        this._targetPosition = position.clone()
        this._isMoving = true
        this._autoTargetEnemy = null  // clear auto-target when user gives command
        //console.log(`[RobotTireController] Moving to ${position.x.toFixed(1)}, ${position.z.toFixed(1)}`)

        // Wake up the render loop
        this.ctx?.viewer?.setDirty()
    }

    stopMoving() {
        this._targetPosition = null
        this._userTargetPosition = null
        this._isMoving = false
        this._autoTargetEnemy = null
    }

    _updateMovement(dt) {
        if (!this._physicsBody) return

        // Sync velocity from physics body
        if (this._physicsBody) {
            this._velocity.x = this._physicsBody.velocity.x
            this._velocity.z = this._physicsBody.velocity.z
        }

        // Priority 1: User command
        if (this._userTargetPosition) {
            const myPos = this.object.position
            const dx = this._userTargetPosition.x - myPos.x
            const dz = this._userTargetPosition.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            // Reached destination
            if (dist < 0.5) {
                this._userTargetPosition = null
                this._targetPosition = null
                this._isMoving = false
                //this._applyPhysics(dt, 0, 0)
                return
            }

            // Move towards user target using physics forces
            const inputX = dx / dist
            const inputZ = dz / dist
            CollisionSystem.applyMovementForce(this._physicsBody, inputX, inputZ, this.acceleration)
            this._updateRotation(dt)
            return
        }

        // Priority 2: Auto-attack nearest enemy
        const nearestEnemy = this._findNearestEnemy()

        if (nearestEnemy && nearestEnemy.distance <= this.detectionRange) {
            this._autoTargetEnemy = nearestEnemy.object
            this._targetPosition = nearestEnemy.object.position.clone()
            this._isMoving = true

            const myPos = this.object.position
            const dx = this._targetPosition.x - myPos.x
            const dz = this._targetPosition.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            // If in attack range, stop (no force applied)
            if (dist <= this.attackRange) {
                this._updateRotation(dt)
                return
            }

            // Move towards enemy using physics forces
            const inputX = dx / dist
            const inputZ = dz / dist
            CollisionSystem.applyMovementForce(this._physicsBody, inputX, inputZ, this.acceleration)
            this._updateRotation(dt)
            return
        }

        // Priority 3: Idle (no command, no enemies) - just let physics damping slow down
        this._autoTargetEnemy = null
        this._targetPosition = null
        this._isMoving = false
        this._updateRotation(dt)
    }

    _updateRotation(dt) {
        // Face movement direction (smooth rotation)
        const currentSpeed = this.getCurrentSpeed()
        if (currentSpeed > 0.1 && this._velocity) {
            const targetRotation = Math.atan2(this._velocity.x, this._velocity.z)
            let rotDiff = targetRotation - this.object.rotation.y
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
            this.object.rotation.y += rotDiff * Math.min(1, 10 * dt)
        }
    }

    _findNearestEnemy() {
        const viewer = this.ctx?.viewer
        if (!viewer) return null

        const myPos = this.object.position
        let closest = null
        let closestDist = this.detectionRange

        // Find CrowdController and check its members
        const crowdControllers = this.ctx?.ecp?.getComponentsOfType?.('CrowdController') || []
        for (const crowdCtrl of crowdControllers) {
            if (!crowdCtrl._members) continue
            for (const member of crowdCtrl._members) {
                if (!member.isAlive || !member.mesh) continue
                const dist = myPos.distanceTo(member.mesh.position)
                if (dist < closestDist) {
                    closestDist = dist
                    closest = { object: member.mesh, controller: member, distance: dist }
                }
            }
        }

        // Also check for legacy enemy controllers
        viewer.scene.traverse((obj) => {
            if (obj === this.object) return

            // Check for enemy controllers
            const enemy = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController')

            if (enemy && enemy.isAlive) {
                const dist = myPos.distanceTo(obj.position)
                if (dist < closestDist) {
                    closestDist = dist
                    closest = { object: obj, controller: enemy, distance: dist }
                }
            }
        })

        return closest
    }

    // Custom physics removed - now using CollisionSystem with cannon-es

    getCurrentSpeed() {
        if (!this._velocity) return 0
        return Math.sqrt(this._velocity.x ** 2 + this._velocity.z ** 2)
    }

    getMomentum() {
        return this.getCurrentSpeed() * this.mass
    }

    // ==================== IMPACT DAMAGE ====================
    // Collision detection and damage handling moved to CollisionSystem
    // Collision listeners are attached to each body in CollisionSystem.getOrCreateBody() automatically

    // ==================== COMBAT ====================

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return

        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage

        //console.log(`[RobotTireController] Took ${effectiveDamage} damage (${this.health}/${this.maxHealth} HP)`)

        if (this.health <= 0) {
            this._die(attacker)
        }
    }

    _die(attacker = null) {
        //console.log('[RobotTireController] Died!')
        this.deselect()

        // Hide object first (ensure death happens)
        if (this.object) {
            this.object.visible = false
        }

        // Remove physics body and debug visualization
        const physicsManager = getPhysicsWorldManager()
        if (physicsManager && physicsManager.world && this._physicsBody) {
            CollisionSystem.removeBody(this.object, physicsManager.world)
            this._physicsBody = null
        }

        // Try to spawn ragdoll (non-blocking)
        try {
            const worldPos = new THREE.Vector3()
            this.object.getWorldPosition(worldPos)

            // Calculate impact velocity from attacker
            let impactVelocity = new THREE.Vector3()
            if (attacker && attacker.object) {
                const attackerPos = new THREE.Vector3()
                attacker.object.getWorldPosition(attackerPos)
                impactVelocity.subVectors(worldPos, attackerPos).normalize()
                impactVelocity.multiplyScalar(30) // Strong impact force
                impactVelocity.y = 10 // Add upward component
            } else if (this._velocity) {
                impactVelocity = this._velocity.clone()
            }

            this._spawnRagdoll(worldPos, impactVelocity)
        } catch (error) {
            console.error('[RobotTireController] Error spawning ragdoll:', error)
        }
    }

    _spawnRagdoll(position, velocity) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.warn('[RobotTireController] No scene found for ragdoll')
            return
        }

        if (!this.ctx?.ecp) {
            console.warn('[RobotTireController] ECP not available for ragdoll')
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
            //console.log('[RobotTireController] Spawning soldier ragdoll at', position)
            // Spawn ragdoll with blue color for soldiers
            ragdoll.spawnRagdoll(position, velocity, {
                scale: 1.0,
                color: 0x4444ff, // Blue for soldiers
                enemyType: 'Soldier'
            })
        } else {
            console.warn('[RobotTireController] Failed to get RagdollComponent')
        }
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        if (!this.object) return true  // keep alive

        const dt = deltaTime / 1000

        this._updateHealthBar(deltaTime)
        this._updateSelectionVisual()

        if (!this.isAlive) {
            return true  // keep component alive for respawn
        }

        this._updateMovement(dt)
        // Collision detection/damage handled automatically by CollisionSystem

        // Always return true to keep the update loop running
        return true
    }

    uiConfig = {
        type: 'folder',
        label: 'RobotTireController',
        children: [
            {
                type: 'button',
                label: 'Select',
                onClick: () => this.select(),
            },
            {
                type: 'button',
                label: 'Deselect',
                onClick: () => this.deselect(),
            },
        ],
    }
}

