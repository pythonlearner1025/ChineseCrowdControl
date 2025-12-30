import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import {CollisionSystem} from './CollisionSystem.js'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * Enemy - Plain class holding enemy unit data (NOT a component)
 * Managed by EnemySystemManager only
 */
class Enemy {
    constructor(mesh, manager, config = {}) {
        this.mesh = mesh
        this.manager = manager

        // Stats
        this.enemyType = config.enemyType || 'base'
        this.health = config.health || 100
        this.maxHealth = config.maxHealth || 100
        this.speed = config.speed || 6
        this.armor = config.armor || 0
        this.attackRange = config.attackRange || 2
        this.detectionRange = config.detectionRange || 15
        this.damage = config.damage || 10
        this.attackFrequency = config.attackFrequency || 1
        this.knockbackResistance = config.knockbackResistance || 0.2
        this.mass = config.mass || 1.5
        this.friction = config.friction || 6
        this.collisionRadius = config.collisionRadius || 1.2

        // Animation properties
        this.animationScale = config.animationScale || 1.0
        this.animationColor = config.animationColor || 0xff4444

        // Runtime state
        this._isAlive = true
        this._currentTarget = null
        this._lastAttackTime = 0
        this._path = []
        this._pathIndex = 0
        this._lastPathUpdate = 0
        this._velocity = new THREE.Vector3()
        this._displayedHealth = this.health

        // Physics & rendering
        this._physicsBody = null
        this._healthBarGroup = null
        this._healthBarFill = null
        this._healthBarBg = null
        this._animComp = null

        // Humanoid body parts (created by manager, not Enemy)
        this._humanoidBodyParts = null
        this._humanoidRootObject = null

        this._createHealthBar()
    }

    get isAlive() {
        return this._isAlive && this.health > 0
    }

    _createHealthBar() {
        const barWidth = 1.0
        const barHeight = 0.25

        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'EnemyHealthBar'

        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
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
    }

    addHealthBarToScene(scene) {
        if (this._healthBarGroup && scene) {
            scene.add(this._healthBarGroup)
        }
    }

    removeHealthBar(scene) {
        if (this._healthBarGroup && scene) {
            scene.remove(this._healthBarGroup)
            this._healthBarBg?.geometry.dispose()
            this._healthBarBg?.material.dispose()
            this._healthBarFill?.geometry.dispose()
            this._healthBarFill?.material.dispose()
        }
    }

    takeDamage(amount, attacker = null) {
        if (!this._isAlive) return
        this.health -= amount
        if (this.health <= 0) {
            this.health = 0
            this._isAlive = false
            if (this.manager) {
                this.manager.onEnemyDeath(this, attacker)
            }
        }
    }
}

/**
 * EnemySystemManager - Centralized manager for ALL enemies
 *
 * Manager/System Pattern - Flat Hierarchy:
 * - ONE manager controls lifecycle and update logic for ALL enemies
 * - Enemy is a plain class holding unit data (NOT a component)
 * - Spawners register enemies with this manager
 * - Manager handles physics, pathfinding, rendering, cleanup
 */
export class EnemySystemManager extends Object3DComponent {
    static StateProperties = ['enabled', 'pathUpdateInterval']
    static ComponentType = 'EnemySystemManager'

    enabled = true
    pathUpdateInterval = 500

    // Internal state
    _enemies = []  // Array of Enemy instances
    _physicsWorld = null
    _player = null
    _cityHall = null
    _initialized = false

    // A* grid settings
    _gridSize = 1
    _gridRange = 50

    // ==================== A* PATHFINDING ====================

    _worldToGrid(x, z) {
        return {
            x: Math.round(x / this._gridSize),
            z: Math.round(z / this._gridSize)
        }
    }

    _gridToWorld(gx, gz) {
        return {
            x: gx * this._gridSize,
            z: gz * this._gridSize
        }
    }

    _heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
    }

    _getNeighbors(node) {
        const dirs = [
            {x: 0, z: 1}, {x: 0, z: -1}, {x: 1, z: 0}, {x: -1, z: 0},
            {x: 1, z: 1}, {x: 1, z: -1}, {x: -1, z: 1}, {x: -1, z: -1}
        ]
        return dirs.map(d => ({x: node.x + d.x, z: node.z + d.z}))
    }

    _findPath(startX, startZ, endX, endZ) {
        const start = this._worldToGrid(startX, startZ)
        const end = this._worldToGrid(endX, endZ)

        if (start.x === end.x && start.z === end.z) return []

        const openSet = []
        const closedSet = new Set()
        const cameFrom = new Map()
        const gScore = new Map()
        const fScore = new Map()
        const key = (n) => `${n.x},${n.z}`

        openSet.push(start)
        gScore.set(key(start), 0)
        fScore.set(key(start), this._heuristic(start, end))

        let iterations = 0
        while (openSet.length > 0 && iterations < 200) {
            iterations++
            openSet.sort((a, b) => (fScore.get(key(a)) || Infinity) - (fScore.get(key(b)) || Infinity))
            const current = openSet.shift()
            const currentKey = key(current)

            if (current.x === end.x && current.z === end.z) {
                const path = []
                let node = current
                while (node) {
                    path.unshift(this._gridToWorld(node.x, node.z))
                    node = cameFrom.get(key(node))
                }
                return path.slice(1)
            }

            closedSet.add(currentKey)

            for (const neighbor of this._getNeighbors(current)) {
                const neighborKey = key(neighbor)
                if (closedSet.has(neighborKey)) continue

                const isDiagonal = neighbor.x !== current.x && neighbor.z !== current.z
                const moveCost = isDiagonal ? 1.414 : 1
                const tentativeG = (gScore.get(currentKey) || 0) + moveCost

                const inOpen = openSet.some(n => n.x === neighbor.x && n.z === neighbor.z)
                if (!inOpen) {
                    openSet.push(neighbor)
                } else if (tentativeG >= (gScore.get(neighborKey) || Infinity)) {
                    continue
                }

                cameFrom.set(neighborKey, current)
                gScore.set(neighborKey, tentativeG)
                fScore.set(neighborKey, tentativeG + this._heuristic(neighbor, end))
            }
        }

        return []
    }

    // ==================== LIFECYCLE ====================

    start() {
        if (super.start) super.start()

        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager) {
            console.error('[EnemySystemManager] No PhysicsWorldManager found!')
            return
        }
        this._physicsWorld = physicsManager.world

        this._findPlayer()
        this._findCityHall()
        this._initialized = true
    }

    stop() {
        if (super.stop) super.stop()

        // Cleanup all enemies
        for (const enemy of this._enemies) {
            this._cleanupEnemy(enemy)
        }

        this._enemies = []
        this._initialized = false
    }

    /**
     * Register an enemy with the manager (called by spawners)
     * @param {THREE.Object3D} mesh - Enemy mesh
     * @param {Object} config - Enemy configuration
     * @returns {Enemy} The created enemy instance
     */
    registerEnemy(mesh, config = {}) {
        const enemy = new Enemy(mesh, this, config)

        // Initialize enemy
        this._initializeEnemy(enemy)

        // Add to managed list
        this._enemies.push(enemy)

        return enemy
    }

    /**
     * Initialize enemy (physics, health bar, animation)
     */
    _initializeEnemy(enemy) {
        if (!enemy || !enemy.mesh || !this._physicsWorld) return

        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        // Create physics body (same parameters as CrowdController for proper collision)
        enemy._physicsBody = CollisionSystem.getOrCreateBody(
            enemy.mesh,
            enemy,
            this._physicsWorld,
            {
                bodyType: 'dynamic',  // Fully physics-controlled
                shapeType: 'sphere',
                shapeSize: { radius: enemy.collisionRadius },
                mass: enemy.mass,
                friction: 0.8,
                restitution: 0.3,
                linearDamping: 0.8
            }
        )

        // Create health bar
        enemy.addHealthBarToScene(scene)

        // Setup animation
        this._setupAnimation(enemy)
    }

    _setupAnimation(enemy) {
        if (!enemy.mesh || !this.ctx?.ecp) return

        // Check if mesh already has visual geometry
        const hasVisuals = enemy.mesh.children.some(child =>
            child.type === 'Mesh' || (child.type === 'Group' && child.name !== 'HealthBar')
        )

        if (hasVisuals) {
            return
        }

        // Add humanoid animation component
        this.ctx.ecp.addComponent(enemy.mesh, 'HumanoidAnimationComponent')
        enemy._animComp = EntityComponentPlugin.GetComponent(enemy.mesh, 'HumanoidAnimationComponent')

        if (enemy._animComp) {
            const scale = enemy.animationScale
            const color = enemy.animationColor

            enemy._animComp.scale = scale
            enemy._animComp.color = color
            enemy._animComp.baseSpeed = enemy.speed

            // Manager creates body parts for enemies
            const scene = this.ctx?.viewer?.scene
            if (scene) {
                const {bodyParts, rootObject} = this._createHumanoidBodyParts(enemy, scene, scale, color)
                enemy._animComp.setBodyParts(bodyParts, rootObject)
            }
        }
    }

    _createHumanoidBodyParts(enemy, scene, scale, color) {
        if (!scene) {
            console.error('[EnemySystemManager] No scene found for body parts')
            return {bodyParts: {}, rootObject: null}
        }

        const rootObject = new THREE.Group()
        rootObject.name = 'HumanoidRoot_' + enemy.mesh.name
        scene.add(rootObject)

        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: 0.2
        })

        const bodyConfigs = [
            {name: 'head', shape: 'sphere', radius: 0.25 * scale, offset: new THREE.Vector3(0, 1.5 * scale, 0)},
            {name: 'torso', shape: 'box', size: new THREE.Vector3(0.5 * scale, 0.7 * scale, 0.3 * scale), offset: new THREE.Vector3(0, 0.9 * scale, 0)},
            {name: 'upperArmLeft', shape: 'capsule', radius: 0.1 * scale, height: 0.5 * scale, offset: new THREE.Vector3(0.4 * scale, 1.2 * scale, 0), jointPoint: new THREE.Vector3(0.25 * scale, 1.3 * scale, 0)},
            {name: 'lowerArmLeft', shape: 'capsule', radius: 0.08 * scale, height: 0.5 * scale, offset: new THREE.Vector3(0.65 * scale, 1.2 * scale, 0), jointPoint: new THREE.Vector3(0.4 * scale, 1.2 * scale, 0)},
            {name: 'upperArmRight', shape: 'capsule', radius: 0.1 * scale, height: 0.5 * scale, offset: new THREE.Vector3(-0.4 * scale, 1.2 * scale, 0), jointPoint: new THREE.Vector3(-0.25 * scale, 1.3 * scale, 0)},
            {name: 'lowerArmRight', shape: 'capsule', radius: 0.08 * scale, height: 0.5 * scale, offset: new THREE.Vector3(-0.65 * scale, 1.2 * scale, 0), jointPoint: new THREE.Vector3(-0.4 * scale, 1.2 * scale, 0)},
            {name: 'upperLegLeft', shape: 'capsule', radius: 0.12 * scale, height: 0.6 * scale, offset: new THREE.Vector3(0.15 * scale, 0.3 * scale, 0), jointPoint: new THREE.Vector3(0.15 * scale, 0.6 * scale, 0)},
            {name: 'lowerLegLeft', shape: 'capsule', radius: 0.1 * scale, height: 0.6 * scale, offset: new THREE.Vector3(0.15 * scale, -0.3 * scale, 0), jointPoint: new THREE.Vector3(0.15 * scale, 0.0, 0)},
            {name: 'upperLegRight', shape: 'capsule', radius: 0.12 * scale, height: 0.6 * scale, offset: new THREE.Vector3(-0.15 * scale, 0.3 * scale, 0), jointPoint: new THREE.Vector3(-0.15 * scale, 0.6 * scale, 0)},
            {name: 'lowerLegRight', shape: 'capsule', radius: 0.1 * scale, height: 0.6 * scale, offset: new THREE.Vector3(-0.15 * scale, -0.3 * scale, 0), jointPoint: new THREE.Vector3(-0.15 * scale, 0.0, 0)}
        ]

        const bodyParts = {}

        for (const config of bodyConfigs) {
            let geometry

            if (config.shape === 'sphere') {
                geometry = new THREE.SphereGeometry(config.radius, 16, 16)
            } else if (config.shape === 'box') {
                geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z)
            } else if (config.shape === 'capsule') {
                geometry = new THREE.CapsuleGeometry(config.radius, config.height, 8, 16)
            }

            const mesh = new THREE.Mesh(geometry, material.clone())
            mesh.position.copy(config.offset)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.name = config.name

            rootObject.add(mesh)

            bodyParts[config.name] = {
                mesh: mesh,
                baseOffset: config.offset.clone(),
                jointPoint: config.jointPoint ? config.jointPoint.clone() : config.offset.clone(),
                prevPosition: null
            }
        }

        enemy._humanoidBodyParts = bodyParts
        enemy._humanoidRootObject = rootObject

        return {bodyParts, rootObject}
    }

    _cleanupHumanoidBodyParts(enemy) {
        const scene = this.ctx?.viewer?.scene
        if (!scene || !enemy._humanoidRootObject) return

        for (const part of Object.values(enemy._humanoidBodyParts || {})) {
            if (part.mesh) {
                part.mesh.geometry?.dispose()
                part.mesh.material?.dispose()
            }
        }

        scene.remove(enemy._humanoidRootObject)
        enemy._humanoidBodyParts = null
        enemy._humanoidRootObject = null
    }

    _cleanupEnemy(enemy) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        // Cleanup humanoid body parts
        this._cleanupHumanoidBodyParts(enemy)

        // Remove physics body
        if (enemy._physicsBody && this._physicsWorld) {
            CollisionSystem.removeBody(enemy.mesh, this._physicsWorld)
            enemy._physicsBody = null
        }

        // Remove health bar
        enemy.removeHealthBar(scene)

        // Remove mesh
        if (enemy.mesh) {
            scene.remove(enemy.mesh)
            enemy.mesh.geometry?.dispose()
            enemy.mesh.material?.dispose()
        }
    }

    onEnemyDeath(enemy, attacker = null) {
        if (!enemy.mesh) return

        // Hide mesh
        enemy.mesh.visible = false

        // Cleanup humanoid body parts
        this._cleanupHumanoidBodyParts(enemy)

        // Remove health bar
        const scene = this.ctx?.viewer?.scene
        if (scene) {
            enemy.removeHealthBar(scene)
        }

        // Spawn ragdoll
        this._spawnRagdoll(enemy, attacker)
    }

    _findPlayer() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return
        if (this._player) return
        const controller = this.ctx.ecp.getComponentOfType('PlayerController')
        if (controller) {
            this._player = controller.object
        }
    }

    _findCityHall() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        scene.traverse((obj) => {
            if (obj.name && obj.name.toLowerCase().includes('cityhall')) {
                this._cityHall = obj
            }
        })
    }

    // ==================== COMBAT SYSTEM ====================

    /**
     * Execute attack on target
     */
    _executeAttack(enemy, target) {
        if (!target) return

        // Try to get controller component from target
        const targetController = EntityComponentPlugin.GetComponent(target, 'PlayerController')
            || EntityComponentPlugin.GetComponent(target, 'CityHallController')

        if (targetController && typeof targetController.takeDamage === 'function') {
            targetController.takeDamage(enemy.damage, enemy)
        }
    }

    /**
     * Spawn ragdoll on enemy death
     */
    _spawnRagdoll(enemy, attacker) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.warn('[EnemySystemManager] No scene found for ragdoll')
            return
        }

        if (!this.ctx?.ecp) {
            console.warn('[EnemySystemManager] ECP not available for ragdoll')
            return
        }

        // Get world position
        const worldPos = new THREE.Vector3()
        enemy.mesh.getWorldPosition(worldPos)

        // Calculate impact velocity from attacker
        let impactVelocity = new THREE.Vector3()
        if (attacker && attacker.object) {
            const attackerPos = new THREE.Vector3()
            attacker.object.getWorldPosition(attackerPos)

            // Direction from attacker to victim
            impactVelocity.subVectors(worldPos, attackerPos).normalize()
            impactVelocity.multiplyScalar(30) // Impact force
            impactVelocity.y = 1 // Upward component
        }

        // Create temporary object for ragdoll component
        const ragdollObj = new THREE.Group()
        ragdollObj.position.copy(worldPos)
        scene.add(ragdollObj)

        // Add ragdoll component using ECP
        this.ctx.ecp.addComponent(ragdollObj, 'RagdollComponent')

        // Get the component
        const ragdoll = EntityComponentPlugin.GetComponent(ragdollObj, 'RagdollComponent')

        if (ragdoll) {
            // Capture body states from animation for seamless transition
            const bodyStates = enemy._animComp ?
                enemy._animComp.getBodyStates() : null

            // Spawn ragdoll with enemy-specific config
            ragdoll.spawnRagdoll(worldPos, impactVelocity, {
                scale: enemy.animationScale,
                color: enemy.animationColor,
                enemyType: enemy.enemyType,
                bodyStates: bodyStates
            })
        } else {
            console.warn('[EnemySystemManager] Failed to get RagdollComponent')
        }
    }

    // ==================== AI & MOVEMENT ====================

    /**
     * Update individual enemy AI, pathfinding, and movement
     */
    _updateEnemy(enemy, dt, now) {
        if (!enemy.isAlive || !enemy.mesh) return

        const myPos = enemy.mesh.position

        // Update health bar
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (enemy._healthBarGroup && enemy._healthBarFill) {
            enemy._healthBarGroup.position.set(
                myPos.x,
                myPos.y + 2.5,
                myPos.z
            )

            enemy._displayedHealth += (enemy.health - enemy._displayedHealth) * Math.min(1, 5 * dt)
            const healthPercent = Math.max(0, enemy._displayedHealth / enemy.maxHealth)
            enemy._healthBarFill.scale.x = healthPercent
            enemy._healthBarFill.position.x = -(0.96 / 2) * (1 - healthPercent)

            if (camera) {
                enemy._healthBarGroup.lookAt(camera.position)
            }
        }

        // === CANNON-ES PHYSICS MODE ===
        if (!enemy._physicsBody) return

        // Sync TO body (prepare input for physics)
        CollisionSystem.syncObjectToBody(enemy.mesh, enemy, enemy._physicsBody)

        // Determine target (player or city hall)
        let target = null
        if (this._player) {
            target = this._player
        } else if (this._cityHall) {
            target = this._cityHall
        }

        // No target? Just idle
        if (!target) {
            return
        }

        enemy._currentTarget = target
        const targetPos = target.position

        // Calculate distance to target
        const distToTarget = Math.sqrt(
            Math.pow(targetPos.x - myPos.x, 2) +
            Math.pow(targetPos.z - myPos.z, 2)
        )

        // Outside detection range - idle
        if (distToTarget > enemy.detectionRange) {
            return
        }

        // In attack range - attack (no movement)
        if (distToTarget <= enemy.attackRange) {
            const cooldown = 1000 / enemy.attackFrequency
            if (now - enemy._lastAttackTime >= cooldown) {
                enemy._lastAttackTime = now
                this._executeAttack(enemy, target)
            }
            return
        }

        // Update path periodically
        if (now - enemy._lastPathUpdate > this.pathUpdateInterval || enemy._path.length === 0) {
            enemy._path = this._findPath(myPos.x, myPos.z, targetPos.x, targetPos.z)
            enemy._pathIndex = 0
            enemy._lastPathUpdate = now
        }

        // Follow path
        let inputX = 0
        let inputZ = 0

        if (enemy._path.length > 0 && enemy._pathIndex < enemy._path.length) {
            const waypoint = enemy._path[enemy._pathIndex]
            const dx = waypoint.x - myPos.x
            const dz = waypoint.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            if (dist < 0.3) {
                enemy._pathIndex++
            } else {
                inputX = dx / dist
                inputZ = dz / dist
            }
        }

        // Apply movement force via cannon-es
        const acceleration = enemy.speed
        CollisionSystem.applyMovementForce(enemy._physicsBody, inputX, inputZ, acceleration)

        // Sync FROM body (read physics results)
        CollisionSystem.syncBodyToObject(enemy.mesh, enemy, enemy._physicsBody)

        // Face movement direction
        if (enemy._velocity) {
            const speed = Math.sqrt(enemy._velocity.x ** 2 + enemy._velocity.z ** 2)
            if (speed > 0.1) {
                const targetRotation = Math.atan2(enemy._velocity.x, enemy._velocity.z)
                let rotDiff = targetRotation - enemy.mesh.rotation.y
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
                enemy.mesh.rotation.y += rotDiff * Math.min(1, 10 * dt)
            }
        }
    }

    // ==================== UPDATE LOOP ====================

    update({time, deltaTime}) {
        if (!this.enabled || !this._initialized) return false

        const dt = deltaTime / 1000
        const now = Date.now()
        const scene = this.ctx?.viewer?.scene
        if (!scene) return false

        // Try to find player if not found
        if (!this._player) {
            this._findPlayer()
        }

        let anyActive = false

        for (const enemy of this._enemies) {
            if (!enemy.isAlive) continue

            anyActive = true

            // Update enemy AI and movement
            this._updateEnemy(enemy, dt, now)
        }

        return anyActive
    }
}

// Export Enemy class for use by spawners
export { Enemy }
