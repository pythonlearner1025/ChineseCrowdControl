import {Object3DComponent} from 'threepipe'
import * as CANNON from 'cannon-es'

/**
 * PhysicsWorldManager - Singleton to manage global cannon.js physics world
 */
class PhysicsWorldManager {
    constructor() {
        // Create cannon.js world
        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, -30, 0) // Strong gravity for dramatic falls
        })

        // Contact material settings
        this.world.defaultContactMaterial.friction = 0.4
        this.world.defaultContactMaterial.restitution = 0.3

        // Performance: broad-phase collision detection
        this.world.broadphase = new CANNON.SAPBroadphase(this.world)

        // Allow bodies to sleep when stationary (huge performance gain)
        this.world.allowSleep = true
        this.world.sleepSpeedLimit = 0.1
        this.world.sleepTimeLimit = 1

        this.ragdolls = [] // Track all active ragdolls
        this.groundsInitialized = false

        //console.log('[PhysicsWorldManager] Initialized with gravity:', this.world.gravity)
    }

    initializeGroundPlanes(scene) {
        if (this.groundsInitialized || !scene) return

        // Find ground objects in scene
        const groundObjects = []
        scene.traverse((obj) => {
            const name = obj.name?.toLowerCase() || ''
            if (name.includes('ground') || name.includes('floor') || name.includes('plane')) {
                groundObjects.push(obj)
            }
        })

        if (groundObjects.length > 0) {
            //console.log(`[PhysicsWorldManager] Found ${groundObjects.length} ground objects`)
            for (const ground of groundObjects) {
                this.addGroundPlane(ground.position.y)
            }
        } else {
            // Fallback: create ground at y=0
            //console.log('[PhysicsWorldManager] No ground found, creating default at y=0')
            this.addGroundPlane(0)
        }

        this.groundsInitialized = true
    }

    addGroundPlane(yPosition = 0) {
        const groundBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: new CANNON.Plane()
        })

        // Rotate plane to be horizontal (facing up)
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
        groundBody.position.set(0, yPosition, 0)

        this.world.addBody(groundBody)
        //console.log(`[PhysicsWorldManager] Added ground plane at y=${yPosition}`)
    }

    step(deltaTime) {
        // Fixed timestep for stable physics
        const fixedTimeStep = 1 / 60
        const maxSubSteps = 3
        this.world.step(fixedTimeStep, deltaTime / 1000, maxSubSteps)
    }

    addRagdoll(ragdoll) {
        if (!this.ragdolls.includes(ragdoll)) {
            this.ragdolls.push(ragdoll)
        }
    }

    removeRagdoll(ragdoll) {
        const index = this.ragdolls.indexOf(ragdoll)
        if (index !== -1) {
            this.ragdolls.splice(index, 1)
        }
    }
}

// Global singleton instance
let physicsWorldManager = null

/**
 * PhysicsWorldController - Component that runs the physics simulation
 * Attach this to an invisible object in your scene
 */
export class PhysicsWorldController extends Object3DComponent {
    static StateProperties = ['enabled']
    static ComponentType = 'PhysicsWorldController'

    enabled = true

    start() {
        if (super.start) super.start()

        // Create singleton physics world manager if it doesn't exist
        if (!physicsWorldManager) {
            physicsWorldManager = new PhysicsWorldManager()
        }

        // Initialize ground planes
        const scene = this.ctx?.viewer?.scene
        if (scene) {
            physicsWorldManager.initializeGroundPlanes(scene)
        }

        //console.log('[PhysicsWorldController] Started')
    }

    stop() {
        if (super.stop) super.stop()
        //console.log('[PhysicsWorldController] Stopped')
    }

    update({time, deltaTime}) {
        if (!this.enabled || !physicsWorldManager) return false

        // Step the physics world
        physicsWorldManager.step(deltaTime)

        return true // Mark viewer dirty
    }
}

// Export the getter for physics world manager (for other components to access)
export function getPhysicsWorldManager() {
    return physicsWorldManager
}
