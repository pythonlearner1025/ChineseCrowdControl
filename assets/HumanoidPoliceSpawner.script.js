import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * HumanoidPoliceSpawner - Spawns humanoid police units (balanced units)
 * Attach to empty objects to designate spawn points
 */
export class HumanoidPoliceSpawner extends Object3DComponent {
static StateProperties = [
        'enabled', 'spawnCount', 'spawnRadius', 'autoSpawn'
    ]
    static ComponentType = 'HumanoidPoliceSpawner'

    // Spawner configuration
    enabled = true
    spawnCount = 5
    spawnRadius = 2.0
    autoSpawn = true  // spawn at game start

    // Humanoid Police stats (same as default RobotTireController)
    _policeHealth = 50
    _policeMaxHealth = 50
    _policeArmor = 2
    _policeDamage = 10
    _policeSpeed = 8  // medium
    _policeMass = 10  // standard
    _policeDetectionRange = 25
    _policeAttackRange = 2

    // Internal state
    _spawnedUnits = []

    start() {
        if (super.start) super.start()

        //console.log('[HumanoidPoliceSpawner] Ready to spawn', this.spawnCount, 'humanoid police')

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
            console.warn('[HumanoidPoliceSpawner] Spawner is disabled')
            return
        }

        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.error('[HumanoidPoliceSpawner] No scene available')
            return
        }

        if (!this.ctx?.ecp) {
            console.error('[HumanoidPoliceSpawner] EntityComponentPlugin not available')
            return
        }

        //console.log(`[HumanoidPoliceSpawner] Spawning ${this.spawnCount} humanoid police...`)

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
            unitObj.name = `HumanoidPolice_${i}`

            // Add to scene
            scene.add(unitObj)

            // Add RobotTireController component
            this.ctx.ecp.addComponent(unitObj, 'RobotTireController')
            const controller = EntityComponentPlugin.GetComponent(unitObj, 'RobotTireController')

            if (controller) {
                // Configure humanoid police stats
                controller.health = this._policeHealth
                controller.maxHealth = this._policeMaxHealth
                controller.armor = this._policeArmor
                controller.damage = this._policeDamage
                controller.baseSpeed = this._policeSpeed
                controller.mass = this._policeMass
                controller.detectionRange = this._policeDetectionRange
                controller.attackRange = this._policeAttackRange

                this._spawnedUnits.push(unitObj)
                //console.log(`[HumanoidPoliceSpawner] Spawned humanoid police ${i + 1}/${this.spawnCount} at (${x.toFixed(1)}, ${z.toFixed(1)})`)
            } else {
                console.error('[HumanoidPoliceSpawner] Failed to get RobotTireController for humanoid police', i)
                scene.remove(unitObj)
            }
        }

        //console.log(`[HumanoidPoliceSpawner] Finished spawning ${this._spawnedUnits.length} humanoid police`)
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
        //console.log('[HumanoidPoliceSpawner] Cleaned up all humanoid police')
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
        label: 'Humanoid Police Spawner',
        children: [
            {
                type: 'button',
                label: 'Spawn Humanoid Police',
                onClick: this.TestSpawn,
            },
            {
                type: 'button',
                label: 'Cleanup Humanoid Police',
                onClick: this.TestCleanup,
            },
        ],
    }
}
