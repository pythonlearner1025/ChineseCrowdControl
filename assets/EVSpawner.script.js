import {Object3DComponent} from 'threepipe'
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
        //console.log('[EVSpawner] Ready to spawn', this.spawnCount, 'EVs')
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

        //console.log(`[EVSpawner] ========================================`)
        //console.log(`[EVSpawner] SPAWNING ${this.spawnCount} EVs at position:`, spawnerPos)
        //console.log(`[EVSpawner] Spawn radius: ${this.spawnRadius}`)
        //console.log(`[EVSpawner] ========================================`)

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

            //console.log(`[EVSpawner] Created car body for EV ${i}, body dimensions: 3x1.5x4`)

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

            // Find EnemySystemManager and register enemy with it
            const enemyManager = this.ctx.ecp.getComponentOfType('EnemySystemManager')
            if (!enemyManager) {
                console.error('[EVSpawner] EnemySystemManager not found!')
                scene.remove(enemyObj)
                continue
            }

            // Register enemy with manager (manager controls lifecycle)
            const enemy = enemyManager.registerEnemy(enemyObj, {
                enemyType: 'ev',
                health: this._evHealth,
                maxHealth: this._evMaxHealth,
                speed: this._evSpeed,
                damage: this._evDamage,
                armor: this._evArmor,
                detectionRange: this._evDetectionRange,
                attackRange: this._evAttackRange,
                mass: this._evMass,
                friction: this._evFriction,
                collisionRadius: 2.5,
                animationScale: 1.0,
                animationColor: 0x44ff44
            })

            this._spawnedEnemies.push(enemy)
            //console.log(`[EVSpawner] ✓ Successfully spawned EV ${i + 1}/${this.spawnCount}`)
        }

        //console.log(`[EVSpawner] ========================================`)
        //console.log(`[EVSpawner] FINISHED: Spawned ${this._spawnedEnemies.length}/${this.spawnCount} EVs`)
        //console.log(`[EVSpawner] ========================================`)
    }

    cleanup() {
        // Enemies are managed by EnemySystemManager - it handles cleanup
        // Just clear our reference list
        this._spawnedEnemies = []
        //console.log('[EVSpawner] Cleared enemy references')
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
