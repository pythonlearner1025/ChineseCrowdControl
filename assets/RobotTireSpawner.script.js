import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * RobotTireSpawner - Spawns robot tire units (fast, light units)
 * Attach to empty objects to designate spawn points
 */
export class RobotTireSpawner extends Object3DComponent {
    static StateProperties = [
        'enabled', 'spawnCount', 'spawnRadius', 'autoSpawn'
    ]
    static ComponentType = 'RobotTireSpawner'

    // Spawner configuration
    enabled = true
    spawnCount = 3
    spawnRadius = 2.0
    autoSpawn = true  // spawn at game start

    // Robot Tire stats
    _tireHealth = 30
    _tireMaxHealth = 30
    _tireArmor = 1
    _tireDamage = 8
    _tireSpeed = 15  // fast
    _tireMass = 5  // light
    _tireDetectionRange = 25
    _tireAttackRange = 2

    // Internal state
    _spawnedUnits = []

    start() {
        if (super.start) super.start()

        //console.log('[RobotTireSpawner] Ready to spawn', this.spawnCount, 'robot tires')

        if (this.autoSpawn) {
            // Delay spawn slightly to ensure all systems are initialized
            setTimeout(() => this.spawn(), 100)
        }
    }

    stop() {
        if (super.stop) super.stop()
        this.cleanup()
    }

    // ==================== SPAWNING ====================

    spawn() {
        if (!this.enabled) {
            console.warn('[RobotTireSpawner] Spawner is disabled')
            return
        }

        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.error('[RobotTireSpawner] No scene available')
            return
        }

        if (!this.ctx?.ecp) {
            console.error('[RobotTireSpawner] EntityComponentPlugin not available')
            return
        }

        //console.log(`[RobotTireSpawner] Spawning ${this.spawnCount} robot tires...`)

        const spawnerPos = this.object.position
        this._spawnedUnits = []

        for (let i = 0; i < this.spawnCount; i++) {
            // Calculate spawn position in circle around spawner
            const angle = (Math.PI * 2 * i) / this.spawnCount
            const radius = this.spawnRadius * (0.5 + Math.random() * 0.5)
            const x = spawnerPos.x + Math.cos(angle) * radius
            const z = spawnerPos.z + Math.sin(angle) * radius

            // Create unit object
            const unitObj = new THREE.Group()
            unitObj.position.set(x, spawnerPos.y, z)
            unitObj.name = `RobotTire_${i}`

            // Add to scene
            scene.add(unitObj)

            // Add RobotTireController component
            this.ctx.ecp.addComponent(unitObj, 'RobotTireController')
            const controller = EntityComponentPlugin.GetComponent(unitObj, 'RobotTireController')

            if (controller) {
                // Configure robot tire stats
                controller.health = this._tireHealth
                controller.maxHealth = this._tireMaxHealth
                controller.armor = this._tireArmor
                controller.damage = this._tireDamage
                controller.baseSpeed = this._tireSpeed
                controller.mass = this._tireMass
                controller.detectionRange = this._tireDetectionRange
                controller.attackRange = this._tireAttackRange

                this._spawnedUnits.push(unitObj)
                //console.log(`[RobotTireSpawner] Spawned robot tire ${i + 1}/${this.spawnCount} at (${x.toFixed(1)}, ${z.toFixed(1)})`)
            } else {
                console.error('[RobotTireSpawner] Failed to get RobotTireController for robot tire', i)
                scene.remove(unitObj)
            }
        }

        //console.log(`[RobotTireSpawner] Finished spawning ${this._spawnedUnits.length} robot tires`)
    }

    cleanup() {
        // Remove all spawned units
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        for (const unitObj of this._spawnedUnits) {
            // Get controller to clean up properly
            const controller = EntityComponentPlugin.GetComponent(unitObj, 'RobotTireController')
            if (controller && controller.stop) {
                controller.stop()
            }

            scene.remove(unitObj)
        }

        this._spawnedUnits = []
        //console.log('[RobotTireSpawner] Cleaned up all robot tires')
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
        label: 'Robot Tire Spawner',
        children: [
            {
                type: 'button',
                label: 'Spawn Robot Tires',
                onClick: this.TestSpawn,
            },
            {
                type: 'button',
                label: 'Cleanup Robot Tires',
                onClick: this.TestCleanup,
            },
        ],
    }
}
