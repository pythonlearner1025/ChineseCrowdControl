import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * Crowd - Spawner component for crowd-type enemies
 *
 * Usage:
 * 1. Attach this component to an empty object in the scene
 * 2. Configure crowd size, spawn radius, and member stats
 * 3. On start, spawns N crowd members around parent object
 * 4. Registers all members with EnemySystemManager
 *
 * The crowd members will be managed by EnemySystemManager:
 * - AI/pathfinding handled by manager
 * - Physics handled by manager
 * - Health bars, animations, ragdolls handled by manager
 */
export class Crowd extends Object3DComponent {
    static StateProperties = [
        'enabled',
        'crowdSize',
        'spawnRadius',
        'memberHealth',
        'memberSpeed',
        'memberDamage',
        'memberAttackRange',
        'memberDetectionRange',
        'memberAttackFrequency',
        'memberAnimationScale',
        'memberAnimationColor',
    ]
    static ComponentType = 'Crowd'

    // Configuration
    enabled = true
    crowdSize = 20
    spawnRadius = 8

    // Member stats
    memberHealth = 50
    memberSpeed = 8
    memberDamage = 5
    memberAttackRange = 1.5
    memberDetectionRange = 100
    memberAttackFrequency = 1

    // Member appearance
    memberAnimationScale = 0.8
    memberAnimationColor = 0xff8844  // Orange

    // Internal
    _enemyManager = null
    _spawnedEnemies = []

    start() {
        if (super.start) super.start()

        // Find EnemySystemManager
        this._enemyManager = this.ctx.ecp.getComponentOfType('EnemySystemManager')

        if (!this._enemyManager) {
            console.error('[Crowd] EnemySystemManager not found! Cannot spawn crowd.')
            return
        }

        // Spawn crowd members
        this._spawnCrowd()

        console.log(`[Crowd] Spawned ${this._spawnedEnemies.length} crowd members`)
    }

    stop() {
        if (super.stop) super.stop()

        // Manager handles enemy cleanup automatically
        // Just clear our references
        this._spawnedEnemies = []
    }

    _spawnCrowd() {
        if (!this.enabled || !this.object) return

        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        const center = this.object.position

        for (let i = 0; i < this.crowdSize; i++) {
            this._spawnCrowdMember(center, i, scene)
        }
    }

    _spawnCrowdMember(center, index, scene) {
        // Calculate spawn position (circle around parent object)
        const angle = (index / this.crowdSize) * Math.PI * 2 + Math.random() * 0.5
        const radius = Math.random() * this.spawnRadius
        const x = center.x + Math.cos(angle) * radius
        const z = center.z + Math.sin(angle) * radius

        // Create mesh (simple capsule for crowd members)
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

        // Create enemy config for crowd member
        const config = {
            enemyType: 'Crowd',
            health: this.memberHealth,
            maxHealth: this.memberHealth,
            speed: this.memberSpeed,
            damage: this.memberDamage,
            attackRange: this.memberAttackRange,
            detectionRange: this.memberDetectionRange,
            attackFrequency: this.memberAttackFrequency,
            animationScale: this.memberAnimationScale,
            animationColor: this.memberAnimationColor,
            mass: 1.5,
            collisionRadius: 0.5
        }

        // Register with EnemySystemManager
        // Manager handles: physics, health bar, animation, body parts, etc.
        const enemy = this._enemyManager.registerEnemy(mesh, config)

        // Keep track of spawned enemies
        this._spawnedEnemies.push(enemy)

        return enemy
    }

    // ==================== UI METHODS ====================

    SpawnMore = () => {
        const scene = this.ctx?.viewer?.scene
        if (!scene || !this.object || !this._enemyManager) return

        const center = this.object.position
        for (let i = 0; i < 5; i++) {
            this._spawnCrowdMember(center, this._spawnedEnemies.length, scene)
        }

        console.log(`[Crowd] Spawned 5 more. Total: ${this._spawnedEnemies.length}`)
    }

    KillAll = () => {
        for (const enemy of this._spawnedEnemies) {
            if (enemy.isAlive) {
                enemy.takeDamage(9999) // Instant kill
            }
        }

        console.log('[Crowd] Killed all crowd members')
    }

    uiConfig = {
        type: 'folder',
        label: 'Crowd',
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
