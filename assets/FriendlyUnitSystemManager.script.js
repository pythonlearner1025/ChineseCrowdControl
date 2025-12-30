import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {CollisionSystem} from './CollisionSystem.js'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * FriendlyUnitSystemManager - Centralized manager for ALL friendly units
 *
 * Manager/System Pattern (Performance-Optimized):
 * - ONE manager updates ALL units in a single loop
 * - Units are lightweight FriendlyUnitData components
 * - Handles: soldiers, robot tires, humanoid police, FPV drones, etc.
 * - Integrated with cannon-es physics
 * - Auto-attack nearest enemy
 * - User movement commands
 *
 * Attach this component to ONE root object in your scene.
 */
export class FriendlyUnitSystemManager extends Object3DComponent {
    static StateProperties = ['enabled']
    static ComponentType = 'FriendlyUnitSystemManager'

    enabled = true

    // Internal state
    _units = []  // Array of FriendlyUnitData components
    _physicsWorld = null
    _initialized = false

    start() {
        if (super.start) super.start()

        // Get physics world
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager) {
            console.error('[FriendlyUnitSystemManager] No PhysicsWorldManager found!')
            return
        }
        this._physicsWorld = physicsManager.world

        // Find initial units
        this._scanForUnits()

        this._initialized = true
        //console.log(`[FriendlyUnitSystemManager] Started managing ${this._units.length} friendly units`)
    }

    stop() {
        if (super.stop) super.stop()

        // Cleanup all unit physics bodies
        for (const unit of this._units) {
            if (unit._physicsBody) {
                CollisionSystem.removeBody(unit.object, this._physicsWorld)
                unit._physicsBody = null
            }
            this._removeSelectionRing(unit)
            this._removeHealthBar(unit)
        }

        this._units = []
        this._initialized = false
    }

    /**
     * Scan scene for all FriendlyUnitData components
     */
    _scanForUnits() {
        this._units = []
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        scene.traverse((obj) => {
            const unitData = EntityComponentPlugin.GetComponent(obj, 'FriendlyUnitData')
            if (unitData && unitData.enabled) {
                this._initializeUnit(unitData)
                this._units.push(unitData)
            }
        })
    }

    /**
     * Initialize a single unit
     */
    _initializeUnit(unit) {
        if (!unit || !unit.object || !this._physicsWorld) return

        // Create physics body
        unit._physicsBody = CollisionSystem.getOrCreateBody(
            unit.object,
            unit,
            this._physicsWorld,
            {
                mass: unit.mass,
                radius: unit.collisionRadius,
                linearDamping: unit.friction ? (1.0 - Math.exp(-unit.friction * 0.1)) : 0.3
            }
        )

        // Create selection ring
        this._createSelectionRing(unit)

        // Create health bar
        this._createHealthBar(unit)
    }

    /**
     * Create selection ring for unit
     */
    _createSelectionRing(unit) {
        if (!unit.object || unit._selectionRing) return

        const geometry = new THREE.RingGeometry(0.6, 0.8, 32)
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        })
        unit._selectionRing = new THREE.Mesh(geometry, material)
        unit._selectionRing.rotation.x = -Math.PI / 2
        unit._selectionRing.position.y = 0.05
        unit._selectionRing.visible = false

        unit.object.add(unit._selectionRing)
    }

    _removeSelectionRing(unit) {
        if (unit._selectionRing && unit.object) {
            unit.object.remove(unit._selectionRing)
            unit._selectionRing.geometry.dispose()
            unit._selectionRing.material.dispose()
        }
        unit._selectionRing = null
    }

    _updateSelectionVisual(unit) {
        if (!unit._selectionRing) return

        unit._selectionRing.visible = unit._isSelected

        // Color based on group
        if (unit._groupId !== null) {
            const colors = [0x00ff00, 0xff6600, 0x0066ff, 0xff00ff, 0xffff00]
            const color = colors[(unit._groupId - 1) % colors.length]
            unit._selectionRing.material.color.setHex(color)
        } else {
            unit._selectionRing.material.color.setHex(0x00ff00)
        }
    }

    /**
     * Create health bar
     */
    _createHealthBar(unit) {
        if (!unit.object || unit._healthBarGroup) return

        const barWidth = 0.8
        const barHeight = 0.15

        unit._healthBarGroup = new THREE.Group()
        unit._healthBarGroup.name = 'UnitHealthBar'

        // Background
        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7
        })
        unit._healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        unit._healthBarGroup.add(unit._healthBarBg)

        // Fill
        const fillGeometry = new THREE.PlaneGeometry(barWidth - 0.04, barHeight - 0.04)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: unit.getAnimationColor(),
            side: THREE.DoubleSide
        })
        unit._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        unit._healthBarFill.position.z = 0.01
        unit._healthBarGroup.add(unit._healthBarFill)

        unit._healthBarGroup.position.y = 2.0
        unit.object.add(unit._healthBarGroup)
    }

    _removeHealthBar(unit) {
        if (unit._healthBarGroup && unit.object) {
            unit.object.remove(unit._healthBarGroup)
            unit._healthBarBg?.geometry.dispose()
            unit._healthBarBg?.material.dispose()
            unit._healthBarFill?.geometry.dispose()
            unit._healthBarFill?.material.dispose()
        }
        unit._healthBarGroup = null
        unit._healthBarFill = null
        unit._healthBarBg = null
    }

    _updateHealthBar(unit, deltaTime) {
        if (!unit._healthBarGroup || !unit._healthBarFill) return

        const dt = deltaTime / 1000
        unit._displayedHealth += (unit.health - unit._displayedHealth) * Math.min(1, 5 * dt)

        const healthPercent = Math.max(0, unit._displayedHealth / unit.maxHealth)
        unit._healthBarFill.scale.x = healthPercent

        const barWidth = 0.76
        unit._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Billboard
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera && unit.object) {
            const cameraWorldPos = new THREE.Vector3()
            camera.getWorldPosition(cameraWorldPos)
            unit._healthBarGroup.lookAt(cameraWorldPos)
        }
    }

    /**
     * Find nearest enemy for unit
     */
    _findNearestEnemy(unit) {
        const viewer = this.ctx?.viewer
        if (!viewer) return null

        const myPos = unit.object.position
        let closest = null
        let closestDist = unit.detectionRange

        viewer.scene.traverse((obj) => {
            if (obj === unit.object) return

            // Check for enemy controllers
            const enemy = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController') ||
                          EntityComponentPlugin.GetComponent(obj, 'EnemyData')

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

    /**
     * Update movement for a unit
     */
    _updateMovement(unit, dt) {
        // Priority 1: User command
        if (unit._userTargetPosition) {
            const myPos = unit.object.position
            const dx = unit._userTargetPosition.x - myPos.x
            const dz = unit._userTargetPosition.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            // Reached destination
            if (dist < 0.5) {
                unit._userTargetPosition = null
                unit._targetPosition = null
                return
            }

            // Move towards user target
            const inputX = dx / dist
            const inputZ = dz / dist

            // Apply force via cannon-es
            if (unit._physicsBody) {
                const acceleration = unit.speed
                CollisionSystem.applyMovementForce(unit._physicsBody, inputX, inputZ, acceleration)
            }
            return
        }

        // Priority 2: Auto-attack nearest enemy
        const nearestEnemy = this._findNearestEnemy(unit)

        if (nearestEnemy && nearestEnemy.distance <= unit.detectionRange) {
            unit._autoTargetEnemy = nearestEnemy.object
            unit._targetPosition = nearestEnemy.object.position.clone()

            const myPos = unit.object.position
            const dx = unit._targetPosition.x - myPos.x
            const dz = unit._targetPosition.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            // If in attack range, no movement needed (damage via collision)
            if (dist <= unit.attackRange) {
                return
            }

            // Move towards enemy
            const inputX = dx / dist
            const inputZ = dz / dist

            if (unit._physicsBody) {
                const acceleration = unit.speed
                CollisionSystem.applyMovementForce(unit._physicsBody, inputX, inputZ, acceleration)
            }
            return
        }

        // Priority 3: Idle (no command, no enemies)
        unit._autoTargetEnemy = null
        unit._targetPosition = null
    }

    /**
     * Public API for unit selection managers
     */
    registerUnit(unit) {
        if (!this._units.includes(unit)) {
            this._initializeUnit(unit)
            this._units.push(unit)
        }
    }

    unregisterUnit(unit) {
        const index = this._units.indexOf(unit)
        if (index !== -1) {
            this._units.splice(index, 1)
            if (unit._physicsBody) {
                CollisionSystem.removeBody(unit.object, this._physicsWorld)
                unit._physicsBody = null
            }
            this._removeSelectionRing(unit)
            this._removeHealthBar(unit)
        }
    }

    // ==================== UPDATE LOOP ====================

    update({deltaTime}) {
        if (!this.enabled || !this._initialized || !this._physicsWorld) return false

        const dt = deltaTime / 1000

        // Update each unit
        for (const unit of this._units) {
            this._updateUnit(unit, dt)
        }

        return true
    }

    _updateUnit(unit, dt) {
        if (!unit || !unit.object) return

        // Always update visuals
        this._updateHealthBar(unit, dt)
        this._updateSelectionVisual(unit)

        if (!unit.isAlive) {
            // Dead unit - handle cleanup
            if (unit._physicsBody) {
                CollisionSystem.removeBody(unit.object, this._physicsWorld)
                unit._physicsBody = null
            }
            unit.object.visible = false
            return
        }

        // Sync cannon body position BEFORE physics step
        if (unit._physicsBody) {
            CollisionSystem.syncObjectToBody(unit.object, unit, unit._physicsBody)
        }

        // Update movement (applies forces to cannon body)
        this._updateMovement(unit, dt)

        // Sync cannon body -> object AFTER physics step
        if (unit._physicsBody) {
            CollisionSystem.syncBodyToObject(unit.object, unit, unit._physicsBody)
        }

        // Face movement direction
        if (unit._velocity) {
            const speed = Math.sqrt(unit._velocity.x ** 2 + unit._velocity.z ** 2)
            if (speed > 0.1) {
                const targetRotation = Math.atan2(unit._velocity.x, unit._velocity.z)
                let rotDiff = targetRotation - unit.object.rotation.y
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
                unit.object.rotation.y += rotDiff * Math.min(1, 10 * dt)
            }
        }
    }
}
