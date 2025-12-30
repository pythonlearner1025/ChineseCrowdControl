import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import {CollisionSystem} from './CollisionSystem.js'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * CrowdMember - Simple class to hold crowd member data (not a component)
 * Now integrated with cannon-es physics for realistic collisions
 */
class CrowdMember {
    // Add ComponentType so CollisionSystem recognizes it as enemy group
    static ComponentType = 'CrowdMember'

    constructor(mesh, controller) {
        this.mesh = mesh
        this.controller = controller
        this.animationComponent = null  // For procedural humanoid animation

        // Humanoid body parts (created by CrowdMember, not HumanoidAnimationComponent)
        this._humanoidBodyParts = null
        this._humanoidRootObject = null

        // Stats
        this.health = 50
        this.maxHealth = 50
        this.speed = 5
        this.damage = 20
        this.attackRange = 1.5
        this.detectionRange = 100
        this.attackFrequency = 1
        this.mass = 1.5  // For collision physics

        // Physics state (for cannon-es integration)
        this._physicsBody = null  // Cannon-es body
        this._velocity = new THREE.Vector3()  // Velocity reference (synced with cannon-es)
        this.collisionRadius = 0.5  // Collision sphere radius

        // State
        this.isAlive = true
        this.lastAttackTime = 0

        // A* pathfinding
        this.path = []
        this.pathIndex = 0
        this.lastPathUpdate = 0
        this.pathUpdateInterval = 500

        // Health bar
        this.healthBarGroup = null
        this.healthBarFill = null
        this.healthBarBg = null
        this.displayedHealth = this.health

        this._createHealthBar()
    }

    _createHealthBar() {
        const barWidth = 0.8
        const barHeight = 0.15

        this.healthBarGroup = new THREE.Group()
        this.healthBarGroup.name = 'CrowdMemberHealthBar'

        // Background
        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        })
        this.healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        this.healthBarGroup.add(this.healthBarBg)

        // Fill
        const fillGeometry = new THREE.PlaneGeometry(barWidth - 0.04, barHeight - 0.04)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            side: THREE.DoubleSide
        })
        this.healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this.healthBarFill.position.z = 0.01
        this.healthBarGroup.add(this.healthBarFill)
    }

    addHealthBarToScene(scene) {
        if (this.healthBarGroup && scene) {
            scene.add(this.healthBarGroup)
        }
    }

    removeHealthBar(scene) {
        if (this.healthBarGroup && scene) {
            scene.remove(this.healthBarGroup)
            this.healthBarBg?.geometry.dispose()
            this.healthBarBg?.material.dispose()
            this.healthBarFill?.geometry.dispose()
            this.healthBarFill?.material.dispose()
        }
    }

    updateHealthBar(camera, dt) {
        if (!this.healthBarGroup || !this.healthBarFill || !this.mesh) return

        // Position above mesh
        this.healthBarGroup.position.set(
            this.mesh.position.x,
            this.mesh.position.y + 2.0,
            this.mesh.position.z
        )

        // Smooth health animation
        this.displayedHealth += (this.health - this.displayedHealth) * Math.min(1, 5 * dt)

        // Update fill
        const healthPercent = Math.max(0, this.displayedHealth / this.maxHealth)
        this.healthBarFill.scale.x = healthPercent
        this.healthBarFill.position.x = -(0.76 / 2) * (1 - healthPercent)

        // Billboard
        if (camera) {
            this.healthBarGroup.lookAt(camera.position)
        }
    }

    // Note: Body part creation/cleanup moved to CrowdController
    // Data classes should not have create/destroy logic

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return
        this.health -= amount
        if (this.health <= 0) {
            this.health = 0
            this.isAlive = false

            // Get scene before hiding anything (needed for cleanup)
            const scene = this.controller?.ctx?.viewer?.scene

            // Hide mesh first (ensure death happens)
            this.mesh.visible = false

            // Clean up humanoid body parts (CRITICAL - removes the 10 frozen body parts!)
            // Manager is responsible for cleanup, not data class
            if (scene && this.controller) {
                this.controller._cleanupHumanoidBodyParts(this, scene)
            }

            // Clean up animation component reference
            if (this.animationComponent) {
                this.animationComponent = null
            }

            // Remove health bar
            if (scene) {
                this.removeHealthBar(scene)
            }

            // Try to spawn ragdoll (non-blocking)
            try {
                const controller = this.controller
                if (controller) {
                    const worldPos = new THREE.Vector3()
                    this.mesh.getWorldPosition(worldPos)

                    // Calculate impact velocity from soldier attacker
                    let impactVelocity = new THREE.Vector3()

                    if (attacker && attacker.object) {
                        // Attacker is the soldier controller
                        const attackerPos = new THREE.Vector3()
                        attacker.object.getWorldPosition(attackerPos)

                        // Calculate direction from attacker to victim
                        impactVelocity.subVectors(worldPos, attackerPos).normalize()
                        impactVelocity.multiplyScalar(30) // Impact force
                        impactVelocity.y = 1 // Upward component

                        //console.log('[CrowdMember] Impact from soldier at', attackerPos, 'velocity:', impactVelocity)
                    } else {
                        console.error('[CrowdMember] No attacker or attacker.object found!', attacker)
                    }

                    controller._spawnCrowdMemberRagdoll(this, worldPos, impactVelocity)
                }
            } catch (error) {
                console.error('[CrowdMember] Error spawning ragdoll:', error)
            }
        }
    }
}

/**
 * CrowdController - Spawns and manages N crowd members with A* pathfinding
 */
export class CrowdController extends Object3DComponent {
    static StateProperties = [
        'enabled', 'crowdSize', 'spawnRadius', 'memberHealth', 'memberSpeed',
        'memberDamage', 'separationRadius', 'separationStrength', 'respawnDelay'
    ]
    static ComponentType = 'CrowdController'

    enabled = true
    crowdSize = 20
    spawnRadius = 8
    memberHealth = 50
    memberSpeed = 8
    memberDamage = 5
    separationRadius = 1.5
    separationStrength = 3.0
    respawnDelay = 5000

    // Internal
    _members = []
    _player = null
    _initialized = false
    _gridSize = 1
    _debugTimer = 0
    _physicsWorld = null    // Cannon-es world reference

    // Collision settings (deprecated - cannon-es handles collisions now)
    collisionRadius = 1.0   // radius for crowd-soldier collision
    collisionDamageToSoldier = 3
    collisionDamageToCrowd = 5
    collisionPushStrength = 8

    start() {
        if (super.start) super.start()
        this._members = []
        this._player = null

        // Get physics world
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager) {
            console.error('[CrowdController] No PhysicsWorldManager found!')
            return
        }
        this._physicsWorld = physicsManager.world

        // Find player
        this._findPlayer()

        // Spawn crowd with cannon-es physics
        this._spawnCrowd()
        this._initialized = true

        //console.log(`[CrowdController] Started with ${this._members.length} members using cannon-es physics`)
    }

    stop() {
        if (super.stop) super.stop()
        this._cleanup()
    }

    _cleanup() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        for (const member of this._members) {
            if (member) {
                // Clean up humanoid body parts (Manager cleans up, not data class)
                this._cleanupHumanoidBodyParts(member, scene)

                // Remove health bar
                member.removeHealthBar(scene)

                // Remove cannon-es physics body
                if (member._physicsBody && this._physicsWorld) {
                    CollisionSystem.removeBody(member.mesh, this._physicsWorld)
                    member._physicsBody = null
                }

                if (member.mesh) {
                    scene.remove(member.mesh)
                    member.mesh.geometry?.dispose()
                    member.mesh.material?.dispose()
                }
            }
        }
        this._members = []
    }

    // ==================== HUMANOID BODY PARTS (Manager-level) ====================

    _createHumanoidBodyParts(member, scene, scale, color) {
        if (!scene) {
            console.error('[CrowdController] No scene found for body parts')
            return {bodyParts: {}, rootObject: null}
        }

        // Create root object to hold all body parts
        const rootObject = new THREE.Group()
        rootObject.name = 'HumanoidRoot_' + member.mesh.name
        scene.add(rootObject)

        // Material for all body parts
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: 0.2
        })

        // Body part configurations
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

        // Create meshes for each body part
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

        member._humanoidBodyParts = bodyParts
        member._humanoidRootObject = rootObject

        return {bodyParts, rootObject}
    }

    _cleanupHumanoidBodyParts(member, scene) {
        if (!scene || !member._humanoidRootObject) return

        // Dispose all body part meshes
        for (const part of Object.values(member._humanoidBodyParts || {})) {
            if (part.mesh) {
                part.mesh.geometry?.dispose()
                part.mesh.material?.dispose()
            }
        }

        // Remove root object from scene
        scene.remove(member._humanoidRootObject)

        member._humanoidBodyParts = null
        member._humanoidRootObject = null
    }

    _findPlayer() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return null

        scene.traverse((obj) => {
            if (this._player) return
            const controller = EntityComponentPlugin.GetComponent(obj, 'PlayerController')
            if (controller) {
                this._player = obj
            }
        })

        if (!this._player) {
            scene.traverse((obj) => {
                if (this._player) return
                if (obj.name && obj.name.toLowerCase().includes('player')) {
                    this._player = obj
                }
            })
        }

        return this._player
    }

    // DEPRECATED: _findSoldiers() removed - cannon-es handles collisions automatically
    // No need to manually find soldiers for collision detection

    _spawnCrowd() {
        const scene = this.ctx?.viewer?.scene
        if (!scene || !this.object) return

        const center = this.object.position

        for (let i = 0; i < this.crowdSize; i++) {
            this._spawnMember(center, i, scene)
        }
    }

    _spawnMember(center, index, scene) {
        const angle = (index / this.crowdSize) * Math.PI * 2 + Math.random() * 0.5
        const radius = Math.random() * this.spawnRadius
        const x = center.x + Math.cos(angle) * radius
        const z = center.z + Math.sin(angle) * radius

        // Create mesh
        const geometry = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8)
        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(Math.random() * 0.1 + 0.05, 0.6, 0.4),
            roughness: 0.7,
            metalness: 0.1
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(x, 0.6, z)
        mesh.name = `CrowdMember_${index}`
        mesh.castShadow = true
        mesh.receiveShadow = true

        scene.add(mesh)

        // Create member data
        const member = new CrowdMember(mesh, this)
        member.health = this.memberHealth
        member.maxHealth = this.memberHealth
        member.speed = this.memberSpeed
        member.damage = this.memberDamage
        member.addHealthBarToScene(scene)

        // CREATE CANNON-ES PHYSICS BODY for crowd member
        if (this._physicsWorld) {
            member._physicsBody = CollisionSystem.getOrCreateBody(
                mesh,
                member,  // member is the "controller"
                this._physicsWorld,
                {
                    bodyType: 'dynamic',  // Fully physics-controlled
                    shapeType: 'sphere',
                    shapeSize: { radius: member.collisionRadius },
                    mass: member.mass,
                    friction: 0.8,
                    restitution: 0.3,
                    linearDamping: 0.8
                }
            )

            // Store velocity reference for syncing
            member._velocity = new THREE.Vector3()
        }

        // Add humanoid animation component
        this.ctx.ecp.addComponent(mesh, 'HumanoidAnimationComponent')
        const animComp = EntityComponentPlugin.GetComponent(mesh, 'HumanoidAnimationComponent')
        if (animComp) {
            const scale = 0.8
            const color = 0xff8844

            animComp.scale = scale
            animComp.color = color
            animComp.baseSpeed = this.memberSpeed
            animComp.walkCycleSpeed = 8
            animComp.legSwingAngle = Math.PI / 6
            animComp.armSwingAngle = Math.PI / 9
            animComp.torsoBobbingHeight = 0.08

            // Create body parts and pass them to animation component (Manager creates, not data class)
            const scene = this.ctx?.viewer?.scene
            if (scene) {
                const {bodyParts, rootObject} = this._createHumanoidBodyParts(member, scene, scale, color)
                animComp.setBodyParts(bodyParts, rootObject)
            }

            member.animationComponent = animComp
        }

        this._members.push(member)
        return member
    }

    _spawnCrowdMemberRagdoll(member, position, velocity) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.warn('[CrowdController] No scene found for ragdoll')
            return
        }

        if (!this.ctx?.ecp) {
            console.warn('[CrowdController] ECP not available for ragdoll')
            return
        }

        // Create temporary object for ragdoll component
        const ragdollObj = new THREE.Group()
        ragdollObj.position.copy(position)
        scene.add(ragdollObj)

        // Add ragdoll component using ECP
        this.ctx.ecp.addComponent(ragdollObj, 'RagdollComponent')

        // Get the component
        const ragdoll = EntityComponentPlugin.GetComponent(ragdollObj, 'RagdollComponent')

        if (ragdoll) {
            //console.log('[CrowdController] Spawning crowd member ragdoll at', position)

            // Capture body states from animation for seamless transition
            const bodyStates = member.animationComponent ?
                member.animationComponent.getBodyStates() : null

            if (bodyStates) {
                //console.log('[CrowdController] Using animated body states for ragdoll')
            }

            // Spawn ragdoll with smaller scale for crowd members
            ragdoll.spawnRagdoll(position, velocity, {
                scale: 0.8, // Smaller for crowd
                color: 0xff8844, // Orange for crowd
                enemyType: 'CrowdMember',
                bodyStates: bodyStates
            })
        } else {
            console.warn('[CrowdController] Failed to get RagdollComponent')
        }
    }

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

        return [end]
    }

    _calculateSeparation(member) {
        const separation = new THREE.Vector3()
        const myPos = member.mesh.position

        for (const other of this._members) {
            if (other === member || !other.isAlive) continue

            const dx = myPos.x - other.mesh.position.x
            const dz = myPos.z - other.mesh.position.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            if (dist < this.separationRadius && dist > 0.01) {
                const strength = (this.separationRadius - dist) / this.separationRadius
                separation.x += (dx / dist) * strength * this.separationStrength
                separation.z += (dz / dist) * strength * this.separationStrength
            }
        }

        return separation
    }

    // ==================== UPDATE ====================

    _updateMember(member, dt, now) {
        if (!member.isAlive || !member.mesh) return

        const myPos = member.mesh.position

        // Update health bar
        const camera = this.ctx?.viewer?.scene?.mainCamera
        member.updateHealthBar(camera, dt)

        // === CANNON-ES PHYSICS MODE ===
        if (member._physicsBody) {
            // Sync TO body (prepare input for physics)
            CollisionSystem.syncObjectToBody(member.mesh, member, member._physicsBody)

            // No player? Just idle (no forces applied)
            if (!this._player) {
                return
            }

            const playerPos = this._player.position
            const distToPlayer = Math.sqrt(
                Math.pow(playerPos.x - myPos.x, 2) +
                Math.pow(playerPos.z - myPos.z, 2)
            )

            // Outside detection range - idle
            if (distToPlayer > member.detectionRange) {
                return
            }

            // In attack range - attack (no movement)
            if (distToPlayer <= member.attackRange) {
                const cooldown = 1000 / member.attackFrequency
                if (now - member.lastAttackTime >= cooldown) {
                    member.lastAttackTime = now
                    const playerController = EntityComponentPlugin.GetComponent(this._player, 'PlayerController')
                    if (playerController && typeof playerController.takeDamage === 'function') {
                        playerController.takeDamage(member.damage, member)
                    }
                }
                return
            }

            // Update path periodically
            if (now - member.lastPathUpdate > member.pathUpdateInterval || member.path.length === 0) {
                member.path = this._findPath(myPos.x, myPos.z, playerPos.x, playerPos.z)
                member.pathIndex = 0
                member.lastPathUpdate = now
            }

            // Follow path
            let inputX = 0
            let inputZ = 0

            if (member.path.length > 0 && member.pathIndex < member.path.length) {
                const target = member.path[member.pathIndex]
                const dx = target.x - myPos.x
                const dz = target.z - myPos.z
                const dist = Math.sqrt(dx * dx + dz * dz)

                if (dist < 0.3) {
                    member.pathIndex++
                } else {
                    inputX = dx / dist
                    inputZ = dz / dist
                }
            }

            // REMOVED: _calculateSeparation() - cannon-es handles crowd separation automatically!
            // Custom separation forces were fighting against physics engine

            // Already normalized from pathfinding, no need to normalize again

            // Apply movement force via cannon-es
            const acceleration = member.speed
            CollisionSystem.applyMovementForce(member._physicsBody, inputX, inputZ, acceleration)

            // Sync FROM body (read physics results from previous frame)
            CollisionSystem.syncBodyToObject(member.mesh, member, member._physicsBody)

            // Face movement direction
            if (member._velocity) {
                const speed = Math.sqrt(member._velocity.x ** 2 + member._velocity.z ** 2)
                if (speed > 0.1) {
                    const targetRotation = Math.atan2(member._velocity.x, member._velocity.z)
                    let rotDiff = targetRotation - member.mesh.rotation.y
                    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
                    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
                    member.mesh.rotation.y += rotDiff * Math.min(1, 10 * dt)
                }
            }
        }
    }

    // DEPRECATED: Custom physics removed - using cannon-es now
    // _applyPhysics() method removed - cannon-es handles all physics

    update({time, deltaTime}) {
        if (!this.enabled || !this._initialized) return false

        const dt = deltaTime / 1000
        const now = Date.now()

        // Try to find player if not found
        if (!this._player) {
            this._findPlayer()
        }

        // Debug log
        this._debugTimer = (this._debugTimer || 0) + deltaTime
        if (this._debugTimer > 3000) {
            this._debugTimer = 0
            const alive = this._members.filter(m => m.isAlive).length
            //console.log(`[CrowdController] alive=${alive}/${this._members.length}, player=${this._player ? this._player.name : 'null'}`)
        }

        // Update each member
        for (const member of this._members) {
            this._updateMember(member, dt, now)
        }
        // Note: Cannon-es handles collisions automatically through collision events
        // No need for manual collision checks!

        return true
    }

    // UI
    SpawnMore = () => {
        const scene = this.ctx?.viewer?.scene
        if (scene && this.object) {
            for (let i = 0; i < 5; i++) {
                this._spawnMember(this.object.position, this._members.length, scene)
            }
        }
    }

    KillAll = () => {
        for (const member of this._members) {
            if (member.isAlive) {
                member.health = 0
                member.isAlive = false
                member.mesh.visible = false
            }
        }
    }

    uiConfig = {
        type: 'folder',
        label: 'CrowdController',
        children: [
            {
                type: 'button',
                label: 'Spawn 5 More',
                onClick: this.SpawnMore,
            },
            {
                type: 'button',
                label: 'Kill All',
                onClick: this.KillAll,
            },
        ],
    }
}

