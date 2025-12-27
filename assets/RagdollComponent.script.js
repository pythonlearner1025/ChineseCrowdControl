import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * RagdollComponent - Creates and manages physics-based ragdoll on death
 */
export class RagdollComponent extends Object3DComponent {
    static StateProperties = ['enabled', 'dismembermentEnabled']
    static ComponentType = 'RagdollComponent'

    enabled = true
    dismembermentEnabled = true

    // Dismemberment thresholds (force required to break joint)
    // Weaker joints = lower threshold
    _jointStrengths = {
        // Weak joints (easy to break)
        'neck': 150,           // Head detaches easily
        'elbowLeft': 200,      // Elbows are weak
        'elbowRight': 200,
        'kneeLeft': 200,       // Knees are weak
        'kneeRight': 200,

        // Strong joints (hard to break)
        'shoulderLeft': 400,   // Shoulders need more force
        'shoulderRight': 400,
        'hipLeft': 400,        // Hips need more force
        'hipRight': 400
    }

    // Internal state
    _bodies = []
    _meshes = []
    _constraints = []
    _constraintMetadata = []  // Store joint info for each constraint
    _isActive = false
    _spawnTime = 0
    _bloodParticles = []

    start() {
        if (super.start) super.start()
    }

    stop() {
        if (super.stop) super.stop()
        this.cleanup()
    }

    /**
     * Spawn a ragdoll at the given position with initial velocity
     * @param {THREE.Vector3} position - World position to spawn ragdoll
     * @param {THREE.Vector3} velocity - Initial velocity (from death momentum)
     * @param {Object} options - { scale: 1.0, color: 0xff4444, enemyType: 'Enemy' }
     */
    spawnRagdoll(position, velocity, options = {}) {
        const { scale = 1.0, color = 0xff4444, enemyType = 'Generic', bodyStates = null } = options

        this._spawnTime = Date.now()
        this._isActive = true

        // Get physics world manager
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager) {
            console.error('[RagdollComponent] No physics world manager found!')
            return
        }

        // Create bodies (use animated body states if available for seamless transition)
        if (bodyStates) {
            this._createRagdollBodiesFromStates(bodyStates, options, physicsManager.world)
        } else {
            this._createRagdollBodies(position, scale, color, physicsManager.world)
        }

        // Create constraints/joints
        this._createRagdollConstraints(physicsManager.world)

        // Apply initial velocity/force for dramatic death
        this._applyDeathForce(velocity)

        // Register with physics manager
        physicsManager.addRagdoll(this)

        console.log(`[RagdollComponent] Spawned ${enemyType} ragdoll at`, position)
    }

    _createRagdollBodies(rootPos, scale, color, world) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        // Material for ragdoll meshes
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: 0.2
        })

        // Body part configurations
        const bodyParts = [
            // Head
            {
                name: 'head',
                shape: 'sphere',
                radius: 0.25 * scale,
                mass: 2.0,
                offset: new THREE.Vector3(0, 1.5 * scale, 0)
            },
            // Torso
            {
                name: 'torso',
                shape: 'box',
                size: new THREE.Vector3(0.5 * scale, 0.7 * scale, 0.3 * scale),
                mass: 10.0,
                offset: new THREE.Vector3(0, 0.9 * scale, 0)
            },
            // Left arm
            {
                name: 'upperArmLeft',
                shape: 'capsule',
                radius: 0.1 * scale,
                height: 0.5 * scale,
                mass: 1.5,
                offset: new THREE.Vector3(0.4 * scale, 1.2 * scale, 0)
            },
            {
                name: 'lowerArmLeft',
                shape: 'capsule',
                radius: 0.08 * scale,
                height: 0.5 * scale,
                mass: 1.0,
                offset: new THREE.Vector3(0.65 * scale, 1.2 * scale, 0)
            },
            // Right arm
            {
                name: 'upperArmRight',
                shape: 'capsule',
                radius: 0.1 * scale,
                height: 0.5 * scale,
                mass: 1.5,
                offset: new THREE.Vector3(-0.4 * scale, 1.2 * scale, 0)
            },
            {
                name: 'lowerArmRight',
                shape: 'capsule',
                radius: 0.08 * scale,
                height: 0.5 * scale,
                mass: 1.0,
                offset: new THREE.Vector3(-0.65 * scale, 1.2 * scale, 0)
            },
            // Left leg
            {
                name: 'upperLegLeft',
                shape: 'capsule',
                radius: 0.12 * scale,
                height: 0.6 * scale,
                mass: 3.0,
                offset: new THREE.Vector3(0.15 * scale, 0.3 * scale, 0)
            },
            {
                name: 'lowerLegLeft',
                shape: 'capsule',
                radius: 0.1 * scale,
                height: 0.6 * scale,
                mass: 2.0,
                offset: new THREE.Vector3(0.15 * scale, -0.3 * scale, 0)
            },
            // Right leg
            {
                name: 'upperLegRight',
                shape: 'capsule',
                radius: 0.12 * scale,
                height: 0.6 * scale,
                mass: 3.0,
                offset: new THREE.Vector3(-0.15 * scale, 0.3 * scale, 0)
            },
            {
                name: 'lowerLegRight',
                shape: 'capsule',
                radius: 0.1 * scale,
                height: 0.6 * scale,
                mass: 2.0,
                offset: new THREE.Vector3(-0.15 * scale, -0.3 * scale, 0)
            }
        ]

        // Create each body part
        for (const config of bodyParts) {
            const position = new THREE.Vector3().addVectors(rootPos, config.offset)

            // Create cannon.js body
            let cannonShape
            if (config.shape === 'sphere') {
                cannonShape = new CANNON.Sphere(config.radius)
            } else if (config.shape === 'box') {
                cannonShape = new CANNON.Box(new CANNON.Vec3(
                    config.size.x / 2,
                    config.size.y / 2,
                    config.size.z / 2
                ))
            } else if (config.shape === 'capsule') {
                cannonShape = new CANNON.Sphere(config.radius)
            }

            const cannonBody = new CANNON.Body({
                mass: config.mass,
                shape: cannonShape,
                position: new CANNON.Vec3(position.x, position.y, position.z),
                linearDamping: 0.01,
                angularDamping: 0.01
            })

            cannonBody.userData = { name: config.name }
            world.addBody(cannonBody)
            this._bodies.push(cannonBody)

            // Create three.js mesh
            let geometry
            if (config.shape === 'sphere') {
                geometry = new THREE.SphereGeometry(config.radius, 16, 16)
            } else if (config.shape === 'box') {
                geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z)
            } else if (config.shape === 'capsule') {
                geometry = new THREE.CapsuleGeometry(config.radius, config.height, 8, 16)
            }

            const mesh = new THREE.Mesh(geometry, material.clone())
            mesh.position.copy(position)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.userData = { name: config.name }

            scene.add(mesh)
            this._meshes.push(mesh)
        }
    }

    _createRagdollBodiesFromStates(bodyStates, options, world) {
        const { scale = 1.0, color = 0xff4444 } = options
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        // Material for ragdoll meshes
        const material = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            metalness: 0.2
        })

        // Map body part names to configurations (matching HumanoidAnimationComponent)
        const bodyPartConfigs = {
            'head': { shape: 'sphere', radius: 0.25 * scale, mass: 2.0 },
            'torso': { shape: 'box', size: new THREE.Vector3(0.5 * scale, 0.7 * scale, 0.3 * scale), mass: 10.0 },
            'upperArmLeft': { shape: 'capsule', radius: 0.1 * scale, height: 0.5 * scale, mass: 1.5 },
            'lowerArmLeft': { shape: 'capsule', radius: 0.08 * scale, height: 0.5 * scale, mass: 1.0 },
            'upperArmRight': { shape: 'capsule', radius: 0.1 * scale, height: 0.5 * scale, mass: 1.5 },
            'lowerArmRight': { shape: 'capsule', radius: 0.08 * scale, height: 0.5 * scale, mass: 1.0 },
            'upperLegLeft': { shape: 'capsule', radius: 0.12 * scale, height: 0.6 * scale, mass: 3.0 },
            'lowerLegLeft': { shape: 'capsule', radius: 0.1 * scale, height: 0.6 * scale, mass: 2.0 },
            'upperLegRight': { shape: 'capsule', radius: 0.12 * scale, height: 0.6 * scale, mass: 3.0 },
            'lowerLegRight': { shape: 'capsule', radius: 0.1 * scale, height: 0.6 * scale, mass: 2.0 }
        }

        // Create bodies from animated states
        for (const [name, state] of Object.entries(bodyStates)) {
            const config = bodyPartConfigs[name]
            if (!config) {
                console.warn(`[RagdollComponent] Unknown body part: ${name}`)
                continue
            }

            // Create cannon.js shape
            let cannonShape
            if (config.shape === 'sphere') {
                cannonShape = new CANNON.Sphere(config.radius)
            } else if (config.shape === 'box') {
                cannonShape = new CANNON.Box(new CANNON.Vec3(
                    config.size.x / 2,
                    config.size.y / 2,
                    config.size.z / 2
                ))
            } else if (config.shape === 'capsule') {
                cannonShape = new CANNON.Sphere(config.radius)
            }

            // Create physics body at exact animated position
            const cannonBody = new CANNON.Body({
                mass: config.mass,
                shape: cannonShape,
                position: new CANNON.Vec3(state.position.x, state.position.y, state.position.z),
                quaternion: new CANNON.Quaternion(
                    state.quaternion.x,
                    state.quaternion.y,
                    state.quaternion.z,
                    state.quaternion.w
                ),
                velocity: new CANNON.Vec3(state.velocity.x, state.velocity.y, state.velocity.z),
                linearDamping: 0.01,
                angularDamping: 0.01
            })

            cannonBody.userData = { name: name }
            world.addBody(cannonBody)
            this._bodies.push(cannonBody)

            // Create three.js mesh at same position
            let geometry
            if (config.shape === 'sphere') {
                geometry = new THREE.SphereGeometry(config.radius, 16, 16)
            } else if (config.shape === 'box') {
                geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z)
            } else if (config.shape === 'capsule') {
                geometry = new THREE.CapsuleGeometry(config.radius, config.height, 8, 16)
            }

            const mesh = new THREE.Mesh(geometry, material.clone())
            mesh.position.copy(state.position)
            mesh.quaternion.copy(state.quaternion)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.userData = { name: name }

            scene.add(mesh)
            this._meshes.push(mesh)
        }

        console.log(`[RagdollComponent] Created ragdoll from ${Object.keys(bodyStates).length} animated body states`)
    }

    _createRagdollConstraints(world) {
        // Helper to find body by name
        const findBody = (name) => {
            return this._bodies.find(b => b.userData?.name === name)
        }

        // Joint configurations
        const joints = [
            // Neck (head to torso)
            {
                name: 'neck',
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'head',
                pivotA: new CANNON.Vec3(0, 0.35, 0),
                pivotB: new CANNON.Vec3(0, -0.25, 0),
                angle: Math.PI / 6
            },
            // Left shoulder
            {
                name: 'shoulderLeft',
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperArmLeft',
                pivotA: new CANNON.Vec3(0.25, 0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0),
                angle: Math.PI / 3
            },
            // Left elbow
            {
                name: 'elbowLeft',
                type: 'PointToPoint',
                bodyA: 'upperArmLeft',
                bodyB: 'lowerArmLeft',
                pivotA: new CANNON.Vec3(0, -0.25, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0)
            },
            // Right shoulder
            {
                name: 'shoulderRight',
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperArmRight',
                pivotA: new CANNON.Vec3(-0.25, 0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0),
                angle: Math.PI / 3
            },
            // Right elbow
            {
                name: 'elbowRight',
                type: 'PointToPoint',
                bodyA: 'upperArmRight',
                bodyB: 'lowerArmRight',
                pivotA: new CANNON.Vec3(0, -0.25, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0)
            },
            // Left hip
            {
                name: 'hipLeft',
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperLegLeft',
                pivotA: new CANNON.Vec3(0.15, -0.35, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0),
                angle: Math.PI / 3
            },
            // Left knee
            {
                name: 'kneeLeft',
                type: 'PointToPoint',
                bodyA: 'upperLegLeft',
                bodyB: 'lowerLegLeft',
                pivotA: new CANNON.Vec3(0, -0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0)
            },
            // Right hip
            {
                name: 'hipRight',
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperLegRight',
                pivotA: new CANNON.Vec3(-0.15, -0.35, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0),
                angle: Math.PI / 3
            },
            // Right knee
            {
                name: 'kneeRight',
                type: 'PointToPoint',
                bodyA: 'upperLegRight',
                bodyB: 'lowerLegRight',
                pivotA: new CANNON.Vec3(0, -0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0)
            }
        ]

        // Create constraints
        for (const joint of joints) {
            const bodyA = findBody(joint.bodyA)
            const bodyB = findBody(joint.bodyB)

            if (!bodyA || !bodyB) {
                console.warn(`[RagdollComponent] Could not find bodies for joint: ${joint.bodyA} <-> ${joint.bodyB}`)
                continue
            }

            let constraint
            if (joint.type === 'ConeTwist') {
                constraint = new CANNON.ConeTwistConstraint(bodyA, bodyB, {
                    pivotA: joint.pivotA,
                    pivotB: joint.pivotB,
                    angle: joint.angle || Math.PI / 4,
                    twistAngle: Math.PI / 4
                })
            } else if (joint.type === 'PointToPoint') {
                constraint = new CANNON.PointToPointConstraint(bodyA, joint.pivotA, bodyB, joint.pivotB, 100)
            }

            if (constraint) {
                world.addConstraint(constraint)
                this._constraints.push(constraint)

                // Store metadata for dismemberment tracking
                this._constraintMetadata.push({
                    constraint: constraint,
                    name: joint.name,
                    bodyA: bodyA,
                    bodyB: bodyB,
                    pivotA: joint.pivotA,
                    pivotB: joint.pivotB,
                    broken: false
                })
            }
        }

        console.log(`[RagdollComponent] Created ${this._constraints.length} constraints`)
    }

    _applyDeathForce(velocity) {
        // Find torso (main body)
        const torso = this._bodies.find(b => b.userData?.name === 'torso')
        if (!torso) return

        // Apply velocity from death momentum (use the velocity directly!)
        if (velocity && velocity.length() > 0) {
            torso.velocity.set(velocity.x, velocity.y, velocity.z)
        } else {
            torso.velocity.set(0, 2, 0) // Just pop up a bit
        }

        // Add random spin for dramatic effect
        torso.angularVelocity.set(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
        )
    }

    _checkDismemberment() {
        const physicsManager = getPhysicsWorldManager()
        if (!physicsManager || !physicsManager.world) return

        // Check each constraint for excessive force
        for (const meta of this._constraintMetadata) {
            if (meta.broken) continue // Already dismembered

            const constraint = meta.constraint
            const jointName = meta.name
            const threshold = this._jointStrengths[jointName] || 300

            // Calculate force magnitude at the joint
            // For PointToPoint constraints, check the impulse magnitude
            // For ConeTwist constraints, check angular violation force
            let forceMagnitude = 0

            if (constraint instanceof CANNON.PointToPointConstraint) {
                // Get relative velocity at constraint point
                const bodyA = meta.bodyA
                const bodyB = meta.bodyB

                const va = bodyA.velocity.vadd(bodyA.angularVelocity.cross(meta.pivotA))
                const vb = bodyB.velocity.vadd(bodyB.angularVelocity.cross(meta.pivotB))
                const relVel = va.vsub(vb)
                forceMagnitude = relVel.length() * (bodyA.mass + bodyB.mass)
            } else if (constraint instanceof CANNON.ConeTwistConstraint) {
                // For cone twist, use angular velocity difference
                const bodyA = meta.bodyA
                const bodyB = meta.bodyB
                const angVelDiff = bodyA.angularVelocity.vsub(bodyB.angularVelocity)
                forceMagnitude = angVelDiff.length() * (bodyA.mass + bodyB.mass) * 50
            }

            // Break joint if force exceeds threshold
            if (forceMagnitude > threshold) {
                console.log(`[RagdollComponent] Dismembering ${jointName}! Force: ${forceMagnitude.toFixed(0)} > ${threshold}`)
                this._dismemberJoint(meta, physicsManager.world)
            }
        }
    }

    _dismemberJoint(meta, world) {
        // Mark as broken
        meta.broken = true

        // Remove constraint from physics world
        world.removeConstraint(meta.constraint)

        // Remove from constraints array
        const index = this._constraints.indexOf(meta.constraint)
        if (index !== -1) {
            this._constraints.splice(index, 1)
        }

        // Get joint world position for blood spawn
        const bodyA = meta.bodyA
        const pivotWorld = bodyA.pointToWorldFrame(meta.pivotA)
        const bloodPos = new THREE.Vector3(pivotWorld.x, pivotWorld.y, pivotWorld.z)

        // Spawn blood particles
        this._spawnBloodSpray(bloodPos)

        // Add impulse to separated body for dramatic effect
        const bodyB = meta.bodyB
        const separationImpulse = bodyA.velocity.vsub(bodyB.velocity).scale(0.5)
        bodyB.applyImpulse(separationImpulse, meta.pivotB)
    }

    _spawnBloodSpray(position) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        // Create 20-30 blood particles
        const particleCount = 20 + Math.floor(Math.random() * 10)

        for (let i = 0; i < particleCount; i++) {
            const geometry = new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 4, 4)
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0.6 + Math.random() * 0.2, 0, 0), // Dark to bright red
                transparent: true,
                opacity: 0.8
            })
            const particle = new THREE.Mesh(geometry, material)

            // Random position offset
            particle.position.copy(position)
            particle.position.x += (Math.random() - 0.5) * 0.3
            particle.position.y += (Math.random() - 0.5) * 0.3
            particle.position.z += (Math.random() - 0.5) * 0.3

            // Random velocity
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 5,
                Math.random() * 3,
                (Math.random() - 0.5) * 5
            )

            scene.add(particle)

            // Store particle data
            this._bloodParticles.push({
                mesh: particle,
                velocity: velocity,
                lifetime: 2000 + Math.random() * 1000, // 2-3 seconds
                spawnTime: Date.now()
            })
        }
    }

    _updateBloodParticles(deltaTime) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        const dt = deltaTime / 1000
        const now = Date.now()

        // Update each particle
        for (let i = this._bloodParticles.length - 1; i >= 0; i--) {
            const particle = this._bloodParticles[i]
            const age = now - particle.spawnTime

            // Remove if lifetime exceeded
            if (age > particle.lifetime) {
                scene.remove(particle.mesh)
                particle.mesh.geometry.dispose()
                particle.mesh.material.dispose()
                this._bloodParticles.splice(i, 1)
                continue
            }

            // Apply physics
            particle.velocity.y -= 9.8 * dt // Gravity
            particle.mesh.position.x += particle.velocity.x * dt
            particle.mesh.position.y += particle.velocity.y * dt
            particle.mesh.position.z += particle.velocity.z * dt

            // Fade out over time
            const fadeProgress = age / particle.lifetime
            particle.mesh.material.opacity = 0.8 * (1 - fadeProgress)

            // Stop at ground
            if (particle.mesh.position.y < 0.1) {
                particle.mesh.position.y = 0.1
                particle.velocity.y = 0
                particle.velocity.x *= 0.8
                particle.velocity.z *= 0.8
            }
        }
    }

    update({time, deltaTime}) {
        if (!this._isActive) return false

        // Check for dismemberment if enabled
        if (this.dismembermentEnabled) {
            this._checkDismemberment()
        }

        // Sync three.js meshes with cannon.js bodies
        for (let i = 0; i < this._bodies.length; i++) {
            const body = this._bodies[i]
            const mesh = this._meshes[i]

            if (mesh && body) {
                mesh.position.copy(body.position)
                mesh.quaternion.copy(body.quaternion)
            }
        }

        // Update blood particles
        this._updateBloodParticles(deltaTime)

        return true // Keep updating
    }

    cleanup() {
        const physicsManager = getPhysicsWorldManager()
        const scene = this.ctx?.viewer?.scene

        if (physicsManager && physicsManager.world) {
            // Remove bodies from physics world
            for (const body of this._bodies) {
                physicsManager.world.removeBody(body)
            }

            // Remove constraints
            for (const constraint of this._constraints) {
                physicsManager.world.removeConstraint(constraint)
            }

            // Unregister from manager
            physicsManager.removeRagdoll(this)
        }

        // Remove meshes from scene
        if (scene) {
            for (const mesh of this._meshes) {
                scene.remove(mesh)
                mesh.geometry?.dispose()
                mesh.material?.dispose()
            }

            // Remove blood particles
            for (const particle of this._bloodParticles) {
                scene.remove(particle.mesh)
                particle.mesh.geometry?.dispose()
                particle.mesh.material?.dispose()
            }
        }

        this._bodies = []
        this._meshes = []
        this._constraints = []
        this._constraintMetadata = []
        this._bloodParticles = []
        this._isActive = false
    }
}
