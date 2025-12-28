import * as THREE from 'three'
import {EntityComponentPlugin} from 'threepipe'

/**
 * CollisionSystem - Universal physics-based collision system for all entities
 *
 * Features:
 * - Elastic collision physics with momentum transfer
 * - Mass-based collision response
 * - Optional collision damage based on relative velocity
 * - Cooldown system to prevent damage spam
 * - Works with any entity type (enemies, friendlies, player)
 */

export class CollisionSystem {
    /**
     * Check and resolve collisions for an entity
     * @param {Object3D} myObject - The entity's THREE.Object3D
     * @param {Object3DComponent} myController - The entity's controller component
     * @param {THREE.Vector3} myVelocity - The entity's current velocity
     * @param {Object} options - Collision options
     * @param {number} options.collisionRadius - Radius for collision detection (default: 1.5)
     * @param {number} options.collisionDamageScale - Damage per unit of relative velocity (default: 0, no damage)
     * @param {number} options.baseDamage - Base damage on collision (default: 0)
     * @param {number} options.cooldownMs - Cooldown between damage instances (default: 300ms)
     * @param {Map} options.cooldownMap - Map to track cooldowns per entity
     * @param {boolean} options.applyPhysics - Apply momentum transfer (default: true)
     * @param {boolean} options.dealDamage - Deal damage on collision (default: false)
     * @param {Array<string>} options.collideWith - Array of component types to collide with (default: all)
     */
    static checkCollisions(myObject, myController, myVelocity, options = {}) {
        if (!myObject || !myController || !myVelocity) return

        const {
            collisionRadius = 1.5,
            collisionDamageScale = 0,
            baseDamage = 0,
            cooldownMs = 300,
            cooldownMap = new Map(),
            applyPhysics = true,
            dealDamage = false,
            collideWith = ['BaseEnemyController', 'GoliathController', 'PlayerController', 'RobotTireController', 'SoldierController']
        } = options

        const scene = myController.ctx?.viewer?.scene
        if (!scene) return

        const myPos = myObject.position
        const myMass = myController.mass || 1.0
        const now = Date.now()

        scene.traverse((obj) => {
            if (obj === myObject) return
            if (!obj.position) return

            // Check if this object has any of the collision components
            let otherController = null
            let componentType = null

            for (const type of collideWith) {
                const controller = EntityComponentPlugin.GetComponent(obj, type)
                if (controller && controller.isAlive) {
                    otherController = controller
                    componentType = type
                    break
                }
            }

            // If we found a component, check collision
            if (otherController) {
                const dist = myPos.distanceTo(obj.position)
                if (dist < collisionRadius && dist >= 0.01) {
                    this._handleCollision({
                        myObject,
                        myController,
                        myVelocity,
                        myMass,
                        otherObject: obj,
                        otherController,
                        otherVelocity: otherController._velocity || otherController.velocity || new THREE.Vector3(),
                        otherMass: otherController.mass || 1.0,
                        distance: dist,
                        collisionRadius,
                        applyPhysics,
                        dealDamage,
                        baseDamage,
                        collisionDamageScale,
                        cooldownMap,
                        cooldownMs,
                        now
                    })
                }
            }

            // Special handling for CrowdController (uses _members array)
            const crowdController = EntityComponentPlugin.GetComponent(obj, 'CrowdController')
            if (crowdController && crowdController._members) {
                for (const member of crowdController._members) {
                    if (!member || !member.isAlive || !member.mesh) continue

                    const dist = myPos.distanceTo(member.mesh.position)
                    if (dist < collisionRadius && dist >= 0.01) {
                        // Debug log for crowd collisions
                        if (Math.random() < 0.01) { // 1% chance to log
                            console.log(`[CollisionSystem] ${myController.name || 'Entity'} colliding with crowd member at dist ${dist.toFixed(2)}`)
                        }

                        // Treat crowd member as a lightweight entity
                        this._handleCollision({
                            myObject,
                            myController,
                            myVelocity,
                            myMass,
                            otherObject: member.mesh,
                            otherController: member,
                            otherVelocity: member.velocity || new THREE.Vector3(),
                            otherMass: member.mass || 1.5,
                            distance: dist,
                            collisionRadius,
                            applyPhysics,
                            dealDamage,
                            baseDamage,
                            collisionDamageScale,
                            cooldownMap,
                            cooldownMs,
                            now
                        })
                    }
                }
            }
        })
    }

    /**
     * Handle a single collision between two entities
     */
    static _handleCollision(params) {
        const {
            myObject, myController, myVelocity, myMass,
            otherObject, otherController, otherVelocity, otherMass,
            distance, collisionRadius,
            applyPhysics, dealDamage, baseDamage, collisionDamageScale,
            cooldownMap, cooldownMs, now
        } = params

        // Calculate collision normal (direction from me to other)
        const dx = otherObject.position.x - myObject.position.x
        const dz = otherObject.position.z - myObject.position.z
        const normal = new THREE.Vector2(dx / distance, dz / distance)

        // Store velocities before collision for debugging
        const myVelBeforeX = myVelocity.x
        const myVelBeforeZ = myVelocity.z
        const otherVelBeforeX = otherVelocity.x
        const otherVelBeforeZ = otherVelocity.z

        // Apply physics-based momentum transfer
        if (applyPhysics) {
            this._applyElasticCollision({
                myVelocity,
                myMass,
                otherVelocity,
                otherMass,
                normal
            })

            // Separate overlapping entities - IMMEDIATE and STRONG
            // Use mass ratio to determine separation - heavier entities push lighter ones more
            const overlap = collisionRadius - distance
            const totalMass = myMass + otherMass
            let otherSeparationRatio = myMass / totalMass  // Lighter gets pushed more
            let mySeparationRatio = otherMass / totalMass  // Heavier gets pushed less

            // CLEARER SEPARATION LOGIC
            // Determine who is heavy and who is light (same as velocity logic)
            const isMyHeavy = myMass > otherMass * 5  // I'm 5x heavier
            const isOtherHeavy = otherMass > myMass * 5  // Other is 5x heavier

            if (isMyHeavy) {
                // I'm the heavy vehicle - I don't move, other takes all separation
                mySeparationRatio = 0
                otherSeparationRatio = 1.0
            } else if (isOtherHeavy) {
                // Other is the heavy vehicle - they don't move, I take all separation
                otherSeparationRatio = 0
                mySeparationRatio = 1.0
            }

            // Apply 1.2x overlap separation to ensure complete separation with margin
            const separationX = normal.x * overlap * 1.2
            const separationZ = normal.y * overlap * 1.2

            myObject.position.x -= separationX * mySeparationRatio
            myObject.position.z -= separationZ * mySeparationRatio
            otherObject.position.x += separationX * otherSeparationRatio
            otherObject.position.z += separationZ * otherSeparationRatio

            // Debug: Log velocity changes
            if (Math.random() < 0.01) { // 1% chance
                const myVelChange = Math.sqrt(
                    Math.pow(myVelocity.x - myVelBeforeX, 2) +
                    Math.pow(myVelocity.z - myVelBeforeZ, 2)
                )
                const otherVelChange = Math.sqrt(
                    Math.pow(otherVelocity.x - otherVelBeforeX, 2) +
                    Math.pow(otherVelocity.z - otherVelBeforeZ, 2)
                )
                console.log(`[Collision] ${myController.name || 'Entity'} (m=${myMass}) hit ${otherController.name || 'Crowd'} (m=${otherMass})`)
                console.log(`  My vel: (${myVelBeforeX.toFixed(2)},${myVelBeforeZ.toFixed(2)}) → (${myVelocity.x.toFixed(2)},${myVelocity.z.toFixed(2)}) [Δ${myVelChange.toFixed(3)}]`)
                console.log(`  Other vel: (${otherVelBeforeX.toFixed(2)},${otherVelBeforeZ.toFixed(2)}) → (${otherVelocity.x.toFixed(2)},${otherVelocity.z.toFixed(2)}) [Δ${otherVelChange.toFixed(3)}]`)
            }
        }

        // Apply collision damage
        if (dealDamage) {
            // Check cooldown
            const lastHit = cooldownMap.get(otherController) || 0
            if (now - lastHit >= cooldownMs) {
                const relativeVelocity = new THREE.Vector2(
                    myVelocity.x - otherVelocity.x,
                    myVelocity.z - otherVelocity.z
                )
                const relativeSpeed = relativeVelocity.length()

                // Calculate damage: base + speed-scaled
                const damage = baseDamage + (relativeSpeed * collisionDamageScale)

                if (damage > 0 && typeof otherController.takeDamage === 'function') {
                    otherController.takeDamage(damage, myController)
                    cooldownMap.set(otherController, now)
                }
            }
        }
    }

    /**
     * Apply elastic collision physics (momentum transfer)
     * Uses 1D elastic collision formula along the collision normal
     *
     * ENHANCED: Asymmetric physics for realistic vehicle collisions
     * - Heavy vehicles (EVs) plow through crowds with minimal slowdown
     * - Lighter entities get launched dramatically
     */
    static _applyElasticCollision(params) {
        const {myVelocity, myMass, otherVelocity, otherMass, normal} = params

        // Project velocities onto collision normal (1D collision along normal)
        const myVelAlongNormal = myVelocity.x * normal.x + myVelocity.z * normal.y
        const otherVelAlongNormal = otherVelocity.x * normal.x + otherVelocity.z * normal.y

        // Calculate relative velocity along normal
        const relativeVel = myVelAlongNormal - otherVelAlongNormal

        // Only skip if clearly moving apart (with small threshold to handle floating point errors)
        if (relativeVel < -0.1) return  // Moving apart, skip

        // REALISTIC COLLISION MODEL with ASYMMETRIC MASS RESPONSE:
        // For large mass differences (e.g., EV vs crowd):
        // - Light entity gets massive impulse (sent flying)
        // - Heavy entity barely slows down (plows through)

        const massRatio = myMass / otherMass
        const inverseMassRatio = otherMass / myMass

        // Restitution varies based on mass ratio
        // Heavy vehicles are more inelastic (absorb energy, keep moving)
        let restitution = 0.4
        if (massRatio > 3.0) {
            restitution = 0.2  // Heavy vehicle collision - very inelastic
        } else if (inverseMassRatio > 3.0) {
            restitution = 0.2  // Being hit by heavy vehicle - very inelastic
        }

        // Base impulse from physics equation
        const baseImpulse = -(1 + restitution) * relativeVel / (1/myMass + 1/otherMass)

        // Mass-based scaling - more conservative approach
        // The key is asymmetric velocity reduction, not massive impulses
        let impulseScale = 1.0
        if (massRatio > 2.0 || inverseMassRatio > 2.0) {
            // For large mass differences, use logarithmic scaling (more controlled)
            const effectiveRatio = Math.max(massRatio, inverseMassRatio)
            impulseScale = 1.0 + Math.log(1 + effectiveRatio) * 1.5
        }

        // Final impulse with moderate scaling
        const finalImpulse = baseImpulse * impulseScale * 2.0  // 2x base multiplier
        const minimumImpulse = 1.0
        const impulse = Math.sign(finalImpulse) * Math.max(Math.abs(finalImpulse), minimumImpulse)

        // CLEARER ASYMMETRIC LOGIC
        // Determine who is heavy and who is light
        const isMyHeavy = myMass > otherMass * 5  // I'm 5x heavier
        const isOtherHeavy = otherMass > myMass * 5  // Other is 5x heavier

        let myDeltaVel = impulse / myMass
        let otherDeltaVel = -impulse / otherMass

        // Apply asymmetric physics
        if (isMyHeavy) {
            // I'm the heavy vehicle (EV) - lock me in place
            myDeltaVel = 0
            // Other is light - amplify their knockback
            otherDeltaVel *= 3.0
        } else if (isOtherHeavy) {
            // Other is the heavy vehicle (EV) - lock them in place
            otherDeltaVel = 0
            // I'm light - amplify my knockback
            myDeltaVel *= 3.0
        }

        // DEBUG: Log heavy vehicle collisions
        if ((isMyHeavy || isOtherHeavy) && Math.random() < 0.05) {
            console.log(`[CollisionSystem] Heavy collision:`)
            console.log(`  My mass: ${myMass.toFixed(1)}, Other mass: ${otherMass.toFixed(1)}`)
            console.log(`  isMyHeavy: ${isMyHeavy}, isOtherHeavy: ${isOtherHeavy}`)
            console.log(`  My ΔVel: ${myDeltaVel === 0 ? 'LOCKED' : myDeltaVel.toFixed(2)}`)
            console.log(`  Other ΔVel: ${otherDeltaVel === 0 ? 'LOCKED' : otherDeltaVel.toFixed(2)}`)
        }

        // Apply velocity changes
        myVelocity.x += myDeltaVel * normal.x
        myVelocity.z += myDeltaVel * normal.y

        otherVelocity.x += otherDeltaVel * normal.x
        otherVelocity.z += otherDeltaVel * normal.y
    }

    /**
     * Get all entities with collision components in the scene
     */
    static getAllCollidableEntities(scene) {
        const entities = []
        const componentTypes = [
            'BaseEnemyController',
            'GoliathController',
            'PlayerController',
            'RobotTireController',
            'SoldierController'
        ]

        scene.traverse((obj) => {
            for (const type of componentTypes) {
                const controller = EntityComponentPlugin.GetComponent(obj, type)
                if (controller && controller.isAlive) {
                    entities.push({
                        object: obj,
                        controller,
                        type
                    })
                    break
                }
            }
        })

        return entities
    }
}
