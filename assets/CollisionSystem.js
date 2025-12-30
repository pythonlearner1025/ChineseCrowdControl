import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import {EntityComponentPlugin} from 'threepipe'

/**
 * CollisionSystem - Physics using cannon-es (NO custom physics)
 *
 * This system:
 * 1. Creates CANNON.Body for each entity (dynamic or kinematic)
 * 2. Lets cannon-es handle ALL physics (collisions, forces, momentum)
 * 3. Reads collision impulse from cannon-es to apply damage
 * 4. Syncs three.js objects with cannon-es bodies
 *
 * Dynamic bodies: Fully controlled by cannon-es physics
 * Kinematic bodies: Position-controlled by game logic, but still collide
 *
 * Zero custom physics - cannon-es does everything!
 */
export class CollisionSystem {
    /**
     * Map: three.js Object3D -> CANNON.Body
     */
    static _entityBodies = new WeakMap()

    /**
     * Map: CANNON.Body -> controller component (for damage callbacks)
     */
    static _bodyToController = new WeakMap()

    /**
     * Map: CANNON.Body -> body type ('dynamic' or 'kinematic')
     */
    static _bodyTypes = new WeakMap()

    /**
     * Damage cooldown tracking: controller -> last damage time
     */
    static _damageCooldowns = new Map()

    /**
     * Create or get physics body for an entity
     * Cannon-es will handle all physics simulation for this body
     *
     * @param {Object3D} object - three.js object
     * @param {Object} controller - controller component
     * @param {CANNON.World} world - cannon-es world
     * @param {Object} options - configuration
     * @param {string} options.bodyType - 'dynamic' (physics-controlled) or 'kinematic' (position-controlled)
     * @param {string} options.shapeType - 'sphere' or 'box'
     * @param {Object} options.shapeSize - {radius} for sphere, {width, height, depth} for box
     * @param {number} options.mass - mass in kg
     */
    static getOrCreateBody(object, controller, world, options = {}) {
        let body = this._entityBodies.get(object)
        if (body && body.world === world) {
            return body
        }

        const {
            bodyType = 'dynamic',  // 'dynamic' or 'kinematic'
            shapeType = 'sphere',  // 'sphere' or 'box'
            shapeSize = null,
            mass = controller.mass || 1.0,
            friction = 0.4,
            restitution = 0.3,
            linearDamping = 0.3,
            angularDamping = 0.3
        } = options

        // Create collision shape based on type
        let shape
        let yOffset = 0

        if (shapeType === 'box') {
            const {width, height, depth} = shapeSize || {width: 2, height: 2, depth: 2}
            shape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2))
            yOffset = height / 2  // Center box at object position
        } else {
            const radius = shapeSize?.radius || controller.collisionRadius || 1.0
            shape = new CANNON.Sphere(radius)
            yOffset = radius  // Offset sphere so bottom touches ground
        }

        // Create physics body - cannon-es will simulate this
        body = new CANNON.Body({
            mass: mass,
            shape: shape,
            material: new CANNON.Material({
                friction: friction,
                restitution: restitution
            }),
            linearDamping: linearDamping,
            angularDamping: angularDamping,
            // fixedRotation: true, // Prevent tipping over
            collisionFilterGroup: this._getCollisionGroup(controller),
            collisionFilterMask: this._getCollisionMask(controller)
        })

        // Set body type (dynamic or kinematic)
        if (bodyType === 'kinematic') {
            body.type = CANNON.Body.KINEMATIC
        } else {
            body.type = CANNON.Body.DYNAMIC
        }

        // Set initial position
        body.position.set(object.position.x, object.position.y + yOffset, object.position.z)

        // Set initial velocity
        if (controller._velocity) {
            body.velocity.set(
                controller._velocity.x || 0,
                0,
                controller._velocity.z || 0
            )
        }

        // Add to cannon-es world (it will now simulate this body)
        world.addBody(body)

        // Store mappings
        this._entityBodies.set(object, body)
        this._bodyToController.set(body, controller)
        this._bodyTypes.set(body, bodyType)

        return body
    }

    /**
     * Collision groups for filtering (bitwise flags)
     * Group 0 (bit 0): Enemies + Crowd
     * Group 1 (bit 1): Player
     * Group 2 (bit 2): Friendly units (soldiers, police, etc.)
     * Group 3 (bit 3): Other
     */
    static _getCollisionGroup(controller) {
        const type = controller.constructor.ComponentType || controller.constructor.name

        // Enemies and Crowd are in same group (both hostile to player/friendlies)
        if (type === 'Enemy' || type === 'CrowdMember') {
            return 1 << 0  // Group 0: Enemies + Crowd
        }
        // Player
        if (type === 'PlayerController') {
            return 1 << 1  // Group 1: Player
        }
        // Friendly units
        if (type === 'RobotTireController' || type === 'FriendlyUnitData') {
            return 1 << 2  // Group 2: Friendlies
        }
        return 1 << 3  // Group 3: Other
    }

    static _getCollisionMask(controller) {
        const type = controller.constructor.ComponentType || controller.constructor.name

        // Enemies + Crowd: collide with player, friendlies, AND other enemies/crowd (for realistic crowding)
        if (type === 'Enemy' || type === 'CrowdMember') {
            return (1 << 0) | (1 << 1) | (1 << 2)  // Collide with enemies+crowd, player, friendlies
        }
        // Player/friendlies: collide with enemies + crowd
        if (type === 'PlayerController' || type === 'RobotTireController' || type === 'FriendlyUnitData') {
            return (1 << 0)  // Collide with enemies+crowd group
        }
        return 0xffffffff  // Other: collide with everything
    }

    /**
     * Remove physics body
     */
    static removeBody(object, world) {
        const body = this._entityBodies.get(object)
        if (body && world) {
            world.removeBody(body)
            this._entityBodies.delete(object)
            this._bodyToController.delete(body)
        }
    }

    /**
     * Sync three.js object -> cannon body (BEFORE physics step)
     *
     * CRITICAL FIX:
     * - Dynamic bodies: DON'T update position (cannon-es controls them)
     * - Kinematic bodies: ONLY update if controller explicitly moved it
     *
     * This prevents overwriting cannon-es physics results every frame!
     */
    static syncObjectToBody(object, controller, body) {
        if (!body || !object || !controller) return

        const bodyType = this._bodyTypes.get(body)

        if (bodyType === 'kinematic') {
            // Kinematic: Only update body IF controller manually moved the object
            // (e.g., WASD input changed object.position)
            // Don't update every frame - that kills physics!
            if (controller._positionDirty) {
                const shape = body.shapes[0]
                let yOffset = 0
                if (shape instanceof CANNON.Sphere) {
                    yOffset = shape.radius
                } else if (shape instanceof CANNON.Box) {
                    yOffset = shape.halfExtents.y
                }
                body.position.set(object.position.x, object.position.y + yOffset, object.position.z)
                controller._positionDirty = false
            }

            // For kinematic bodies, velocity is set by controller (e.g., WASD input velocity)
            if (controller._velocity) {
                body.velocity.set(controller._velocity.x || 0, 0, controller._velocity.z || 0)
            }
        } else {
            // Dynamic: DON'T update position! Cannon-es fully controls it.
            // Only apply external forces if needed
            if (controller._externalForce) {
                body.applyForce(controller._externalForce)
                controller._externalForce = null
            }
        }
    }

    /**
     * Sync cannon body -> three.js object (AFTER physics step)
     *
     * ALWAYS read back physics results for ALL body types.
     * Cannon-es has simulated collisions/forces, update visuals accordingly.
     */
    static syncBodyToObject(object, controller, body) {
        if (!body || !object || !controller) return

        // Always read back physics results (for BOTH dynamic and kinematic)
        object.position.x = body.position.x
        object.position.z = body.position.z

        // FIXED: Read Y from body, but clamp to ground level
        object.position.y = Math.max(0, body.position.y)

        // Update controller velocity (for both types)
        if (controller._velocity) {
            controller._velocity.x = body.velocity.x
            controller._velocity.z = body.velocity.z
        }
    }

    /**
     * Apply movement force to body (cannon-es will integrate this)
     */
    static applyMovementForce(body, inputX, inputZ, acceleration = 100, player = false) {
        if (!body) return

        // CRITICAL: Wake up body before applying forces!
        // Sleeping bodies ignore forces in cannon-es
        body.wakeUp()

        const acc = new CANNON.Vec3(inputX * acceleration, 0, inputZ * acceleration)

        if(!player)
            body.applyForce(acc)
        else {
            body.velocity = acc
        }

    }

    /**
     * Setup collision damage using cannon-es collision events
     * Damage is calculated from collision impulse (force of impact)
     */
    static setupCollisionDamage(world, cooldownMs = 300) {
        world.addEventListener('collide', (event) => {
            const {body: bodyA, target: bodyB, contact} = event

            const controllerA = this._bodyToController.get(bodyA)
            const controllerB = this._bodyToController.get(bodyB)

            if (!controllerA || !controllerB) return
            if (!controllerA.isAlive || !controllerB.isAlive) return

            // Get impulse from cannon-es contact
            // Impulse = force * time, represents the strength of collision
            const contactEquations = contact?.getImpactVelocityAlongNormal ? [contact] : []
            let impulse = 0

            if (contactEquations.length > 0) {
                // Get impact velocity from cannon-es
                const impactVelocity = contactEquations[0].getImpactVelocityAlongNormal()
                // Impulse magnitude (simplified)
                impulse = Math.abs(impactVelocity) * ((bodyA.mass + bodyB.mass) / 2)
            } else {
                // Fallback: calculate from relative velocity
                const relVel = new CANNON.Vec3()
                bodyB.velocity.vsub(bodyA.velocity, relVel)
                impulse = relVel.length() * ((bodyA.mass + bodyB.mass) / 2)
            }

            // Apply damage based on impulse
            const now = Date.now()
            this._applyImpulseDamage(controllerA, controllerB, impulse, cooldownMs, now)
        })
    }

    /**
     * Apply damage based on collision impulse from cannon-es
     * Higher impulse = more damage
     */
    static _applyImpulseDamage(controllerA, controllerB, impulse, cooldownMs, now) {
        const typeA = controllerA.constructor.ComponentType
        const typeB = controllerB.constructor.ComponentType

        // Determine damage direction
        let attacker = null
        let victim = null

        // Enemy -> Player/Friendly
        if (typeA === 'Enemy' &&
            (typeB === 'PlayerController' || typeB === 'RobotTireController' || typeB === 'FriendlyUnitData')) {
            attacker = controllerA
            victim = controllerB
        }
        // Player/Friendly -> Enemy
        else if ((typeA === 'PlayerController'  || typeA === 'RobotTireController' || typeA === 'FriendlyUnitData') &&
                 typeB === 'Enemy') {
            attacker = controllerA
            victim = controllerB
        }

        if (attacker && victim) {
            // Check cooldown
            const lastDamage = this._damageCooldowns.get(victim) || 0
            if (now - lastDamage >= cooldownMs) {
                // Damage = base damage + impulse-based damage
                let damage = attacker.damage || 10

                // Add impulse damage (scale factor determines sensitivity)
                // Higher impulse = harder hit = more damage
                const impulseDamageScale = attacker.impactDamageScale || 5.0
                const impulseDamage = impulse * impulseDamageScale

                damage += impulseDamage

                // Apply damage
                if (typeof victim.takeDamage === 'function') {
                    victim.takeDamage(damage, attacker)
                    this._damageCooldowns.set(victim, now)
                }
            }
        }
    }

    /**
     * Sync ALL entities from cannon-es bodies back to three.js objects
     * Call this AFTER world.step() to update all visuals with physics results
     *
     * @param {CANNON.World} world - cannon-es world
     */
    static syncAllBodiesToObjects(world) {
        if (!world) return

        // Iterate through all bodies in the physics world
        for (const body of world.bodies) {
            const controller = this._bodyToController.get(body)
            if (!controller || !controller.object) continue

            // Sync physics results to visual object
            this.syncBodyToObject(controller.object, controller, body)
        }
    }

    /**
     * Legacy compatibility wrapper (deprecated)
     * For gradual migration - eventually remove this
     */
    static checkCollisions(myObject, myController, myVelocity, options = {}) {
        //console.warn('[CollisionSystem] checkCollisions is deprecated - use cannon-es physics bodies')

        // Simple fallback for legacy code
        const {
            collisionRadius = 1.5,
            cooldownMap = new Map(),
            cooldownMs = 300,
            collideWith = []
        } = options

        const scene = myController.ctx?.viewer?.scene
        if (!scene) return

        const myPos = myObject.position
        const now = Date.now()

        scene.traverse((obj) => {
            if (obj === myObject || !obj.position) return

            let otherController = null
            for (const type of collideWith) {
                const controller = EntityComponentPlugin.GetComponent(obj, type)
                if (controller && controller.isAlive) {
                    otherController = controller
                    break
                }
            }

            if (otherController) {
                const dist = myPos.distanceTo(obj.position)
                if (dist < collisionRadius && dist >= 0.01) {
                    // Simple separation
                    const dx = myPos.x - obj.position.x
                    const dz = myPos.z - obj.position.z
                    const overlap = collisionRadius - dist
                    myObject.position.x += (dx / dist) * overlap * 0.5
                    myObject.position.z += (dz / dist) * overlap * 0.5
                }
            }
        })
    }
}
