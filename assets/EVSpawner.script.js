import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * EVSpawner - Spawns fast Electric Vehicle enemies with ramming damage
 * Attach to empty objects to designate spawn points
 */
export class EVSpawner extends Object3DComponent {
    static StateProperties = [
        'enabled', 'spawnCount', 'spawnRadius', 'autoSpawn'
    ]
    static ComponentType = 'EVSpawner'

    // Spawner configuration
    enabled = true
    spawnCount = 2
    spawnRadius = 5.0
    autoSpawn = false  // spawn on night start

    // EV stats
    _evHealth = 200
    _evMaxHealth = 200
    _evSpeed = 100
    _evDamage = 50  // high ramming damage
    _evArmor = 10
    _evDetectionRange = 30
    _evAttackRange = 2
    _evColor = 0x44ff44  // electric green
    _evScale = 1.5
    _evMass = 20  // VERY heavy vehicle - should plow through everything
    _evFriction = 5  // good turning

    // Internal state
    _spawnedEnemies = []

    start() {
        if (super.start) super.start()
        console.log('[EVSpawner] Ready to spawn', this.spawnCount, 'EVs')
    }

    stop() {
        if (super.stop) super.stop()
        this.cleanup()
    }

    // ==================== SPAWNING ====================

    spawn() {
        if (!this.enabled) {
            console.warn('[EVSpawner] Spawner is disabled')
            return
        }

        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.error('[EVSpawner] No scene available')
            return
        }

        if (!this.ctx?.ecp) {
            console.error('[EVSpawner] EntityComponentPlugin not available')
            return
        }

        const spawnerPos = this.object.position
        this._spawnedEnemies = []

        if (!spawnerPos) {
            console.error('[EVSpawner] Spawner position is null!')
            return
        }

        console.log(`[EVSpawner] ========================================`)
        console.log(`[EVSpawner] SPAWNING ${this.spawnCount} EVs at position:`, spawnerPos)
        console.log(`[EVSpawner] Spawn radius: ${this.spawnRadius}`)
        console.log(`[EVSpawner] ========================================`)

        for (let i = 0; i < this.spawnCount; i++) {
            // Calculate spawn position in circle around spawner
            const angle = (Math.PI * 2 * i) / this.spawnCount
            const radius = this.spawnRadius * (0.5 + Math.random() * 0.5)
            const x = spawnerPos.x + Math.cos(angle) * radius
            const z = spawnerPos.z + Math.sin(angle) * radius

            // Create enemy object
            const enemyObj = new THREE.Group()
            enemyObj.position.set(x, spawnerPos.y, z)
            enemyObj.name = `EV_${i}`

            // Create vehicle geometry (box for car body) - LARGER for visibility
            const carBody = new THREE.Mesh(
                new THREE.BoxGeometry(3, 1.5, 4),  // width, height, length (bigger)
                new THREE.MeshStandardMaterial({
                    color: this._evColor,
                    metalness: 0.6,
                    roughness: 0.2,
                    emissive: this._evColor,
                    emissiveIntensity: 0.3  // make it glow slightly
                })
            )
            carBody.position.y = 0.75  // lift off ground
            carBody.castShadow = true
            carBody.receiveShadow = true
            carBody.name = 'EVBody'
            enemyObj.add(carBody)

            console.log(`[EVSpawner] Created car body for EV ${i}, body dimensions: 3x1.5x4`)

            // Add a smaller box on top for cabin/roof
            const carRoof = new THREE.Mesh(
                new THREE.BoxGeometry(2.2, 0.8, 2),
                new THREE.MeshStandardMaterial({
                    color: this._evColor,
                    metalness: 0.6,
                    roughness: 0.2,
                    emissive: this._evColor,
                    emissiveIntensity: 0.3
                })
            )
            carRoof.position.y = 1.55  // on top of body
            carRoof.position.z = -0.4  // slightly toward back
            carRoof.castShadow = true
            carRoof.name = 'EVRoof'
            enemyObj.add(carRoof)

            // Make sure the object is visible
            enemyObj.visible = true
            carBody.visible = true
            carRoof.visible = true

            // Add to scene
            scene.add(enemyObj)

            // Add BaseEnemyController component
            this.ctx.ecp.addComponent(enemyObj, 'BaseEnemyController')
            const controller = EntityComponentPlugin.GetComponent(enemyObj, 'BaseEnemyController')

            if (controller) {
                // Configure EV stats
                controller.name = 'EV'
                controller.health = this._evHealth
                controller.maxHealth = this._evMaxHealth
                controller.speed = this._evSpeed
                controller.damage = this._evDamage
                controller.armor = this._evArmor
                controller.detectionRange = this._evDetectionRange
                controller.attackRange = this._evAttackRange

                // Vehicle physics: heavy mass, good turning
                controller.mass = this._evMass
                controller.friction = this._evFriction

                // CRITICAL: Set collision radius to match vehicle size (3×4 box)
                controller.collisionRadius = 2.5  // Larger than default 1.2 to cover the EV body

                // Adjust health bar offset for vehicle size
                controller._healthBarOffset = 2.5

                // Add debugging for movement
                let updateCount = 0
                const originalUpdate = controller.update.bind(controller)
                controller.update = function(params) {
                    updateCount++
                    if (updateCount % 120 === 0) { // Log every 2 seconds
                        const target = this._currentTarget
                        const myPos = this.object.position
                        const targetPos = target ? target.position : null
                        const dist = targetPos ? Math.sqrt(
                            Math.pow(targetPos.x - myPos.x, 2) +
                            Math.pow(targetPos.z - myPos.z, 2)
                        ) : 0

                        console.log(`[EV ${i}] DEBUG:`)
                        console.log(`  - Position: (${myPos.x.toFixed(1)}, ${myPos.z.toFixed(1)})`)
                        console.log(`  - Target: ${target ? target.name : 'none'} at (${targetPos?.x.toFixed(1)}, ${targetPos?.z.toFixed(1)})`)
                        console.log(`  - Distance to target: ${dist.toFixed(1)}`)
                        console.log(`  - Attack range: ${this.attackRange}`)
                        console.log(`  - Path length: ${this._path?.length || 0}`)
                        console.log(`  - Path index: ${this._pathIndex}`)
                        console.log(`  - Velocity: (${this._velocity?.x.toFixed(2)}, ${this._velocity?.z.toFixed(2)})`)
                        console.log(`  - Speed: ${this.speed}, Mass: ${this.mass}, Friction: ${this.friction}`)
                    }
                    return originalUpdate(params)
                }

                console.log(`[EVSpawner] EV ${i} configured:`)
                console.log(`  - Mass: ${controller.mass}, Speed: ${controller.speed}`)
                console.log(`  - Enabled: ${controller.enabled}`)
                console.log(`  - Detection range: ${controller.detectionRange}`)

                this._spawnedEnemies.push(enemyObj)

                console.log(`[EVSpawner] ✓ Successfully spawned EV ${i + 1}/${this.spawnCount}`)
                console.log(`  - Position: (${x.toFixed(1)}, ${spawnerPos.y.toFixed(1)}, ${z.toFixed(1)})`)
                console.log(`  - Has ${enemyObj.children.length} children (should have 2 boxes)`)
                console.log(`  - Controller enabled: ${controller.enabled}`)
                console.log(`  - Object visible: ${enemyObj.visible}`)
            } else {
                console.error('[EVSpawner] ✗ FAILED to get BaseEnemyController for EV', i)
                scene.remove(enemyObj)
            }
        }

        console.log(`[EVSpawner] ========================================`)
        console.log(`[EVSpawner] FINISHED: Spawned ${this._spawnedEnemies.length}/${this.spawnCount} EVs`)
        console.log(`[EVSpawner] ========================================`)
    }

    cleanup() {
        // Remove all spawned enemies
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        for (const enemyObj of this._spawnedEnemies) {
            // Get controller to clean up properly
            const controller = EntityComponentPlugin.GetComponent(enemyObj, 'BaseEnemyController')
            if (controller && controller.stop) {
                controller.stop()
            }

            scene.remove(enemyObj)
        }

        this._spawnedEnemies = []
        console.log('[EVSpawner] Cleaned up all EVs')
    }

    // ==================== UI CONFIG ====================

    TestSpawn = () => {
        this.spawn()
    }

    TestCleanup = () => {
        this.cleanup()
    }

    uiConfig = {
        type: 'folder',
        label: 'EV Spawner',
        children: [
            {
                type: 'button',
                label: 'Spawn EVs',
                onClick: this.TestSpawn,
            },
            {
                type: 'button',
                label: 'Cleanup EVs',
                onClick: this.TestCleanup,
            },
        ],
    }
}
