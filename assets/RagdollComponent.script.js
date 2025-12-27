import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import {getPhysicsWorldManager} from './PhysicsWorldController.script.js'

/**
 * RagdollComponent - Creates and manages physics-based ragdoll on death
 */
export class RagdollComponent extends Object3DComponent {
    static StateProperties = ['enabled']
    static ComponentType = 'RagdollComponent'

    enabled = true

    // Internal state
    _bodies = []
    _meshes = []
    _constraints = []
    _isActive = false
    _spawnTime = 0

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
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'head',
                pivotA: new CANNON.Vec3(0, 0.35, 0),
                pivotB: new CANNON.Vec3(0, -0.25, 0),
                angle: Math.PI / 6
            },
            // Left shoulder
            {
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperArmLeft',
                pivotA: new CANNON.Vec3(0.25, 0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0),
                angle: Math.PI / 3
            },
            // Left elbow
            {
                type: 'PointToPoint',
                bodyA: 'upperArmLeft',
                bodyB: 'lowerArmLeft',
                pivotA: new CANNON.Vec3(0, -0.25, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0)
            },
            // Right shoulder
            {
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperArmRight',
                pivotA: new CANNON.Vec3(-0.25, 0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0),
                angle: Math.PI / 3
            },
            // Right elbow
            {
                type: 'PointToPoint',
                bodyA: 'upperArmRight',
                bodyB: 'lowerArmRight',
                pivotA: new CANNON.Vec3(0, -0.25, 0),
                pivotB: new CANNON.Vec3(0, 0.25, 0)
            },
            // Left hip
            {
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperLegLeft',
                pivotA: new CANNON.Vec3(0.15, -0.35, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0),
                angle: Math.PI / 3
            },
            // Left knee
            {
                type: 'PointToPoint',
                bodyA: 'upperLegLeft',
                bodyB: 'lowerLegLeft',
                pivotA: new CANNON.Vec3(0, -0.3, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0)
            },
            // Right hip
            {
                type: 'ConeTwist',
                bodyA: 'torso',
                bodyB: 'upperLegRight',
                pivotA: new CANNON.Vec3(-0.15, -0.35, 0),
                pivotB: new CANNON.Vec3(0, 0.3, 0),
                angle: Math.PI / 3
            },
            // Right knee
            {
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

    update({time, deltaTime}) {
        if (!this._isActive) return false

        // Sync three.js meshes with cannon.js bodies
        for (let i = 0; i < this._bodies.length; i++) {
            const body = this._bodies[i]
            const mesh = this._meshes[i]

            if (mesh && body) {
                mesh.position.copy(body.position)
                mesh.quaternion.copy(body.quaternion)
            }
        }

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
        }

        this._bodies = []
        this._meshes = []
        this._constraints = []
        this._isActive = false
    }
}
