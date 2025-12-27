import {BaseEnemyController} from './BaseEnemyController.script.js'

/**
 * GoliathController - Large, slow enemy with massive health and devastating attacks
 * Poor range but extremely dangerous up close
 */
export class GoliathController extends BaseEnemyController {
    static StateProperties = [
        ...BaseEnemyController.StateProperties,
        'groundPoundCooldown', 'isEnraged'
    ]
    static ComponentType = 'GoliathController'

    // Goliath-specific attributes - overrides base values
    name = 'Goliath'
    health = 1500
    maxHealth = 500
    speed = 3                // very slow (2x base)
    armor = 15               // heavily armored
    attackRange = 1.5        // poor range, must get very close
    detectionRange = 12      // slightly lower awareness
    damage = 300              // devastating damage
    attackFrequency = 0.5    // slow attacks (1 every 2 seconds)
    knockbackResistance = 0.8  // very hard to push

    // Goliath-specific abilities
    groundPoundCooldown = 8  // seconds between ground pounds
    isEnraged = false        // enrages at low health

    // Internal
    _lastGroundPound = 0
    _enrageThreshold = 0.3   // enrages below 30% HP

    start() {
        super.start()
        this._lastGroundPound = 0
    }

    // Animation overrides for larger scale and different color
    _getAnimationScale() {
        return 2.0  // Large goliath
    }

    _getAnimationColor() {
        return 0xaa0000  // Dark red
    }

    /*
    update(params) {
        // Always update health bar first (via super), then do Goliath-specific logic
        if (!this.enabled || !this.isAlive) {
            // Still need to update health bar even when dead/disabled
            this._updateHealthBar(params?.deltaTime || 16)
            return false
        }

        // Check for enrage
        const healthPercent = this.health / this.maxHealth
        if (!this.isEnraged && healthPercent <= this._enrageThreshold) {
            this._enrage()
        }

        // Attempt ground pound if player is close-ish but not in melee
        if (this._player) {
            const myPos = this.object.position
            const playerPos = this._player.position
            const dist = Math.sqrt(
                Math.pow(playerPos.x - myPos.x, 2) +
                Math.pow(playerPos.z - myPos.z, 2)
            )

            // Ground pound at medium range
            if (dist > this.attackRange && dist < this.attackRange * 3) {
                this._tryGroundPound()
            }
        }

        return super.update(params)
    }
        */

    _enrage() {
        this.isEnraged = true
        this.speed *= 1.5          // faster when enraged
        this.damage *= 1.25        // more damage
        this.attackFrequency *= 1.3
    }

    _tryGroundPound() {
        const now = Date.now()
        const cooldownMs = this.groundPoundCooldown * 1000

        if (now - this._lastGroundPound < cooldownMs) return false

        this._lastGroundPound = now

        // Deal damage in an area around the Goliath
        this._groundPoundAttack()
        return true
    }

    _groundPoundAttack() {
        if (!this._player) return

        const myPos = this.object.position
        const playerPos = this._player.position
        const dist = Math.sqrt(
            Math.pow(playerPos.x - myPos.x, 2) +
            Math.pow(playerPos.z - myPos.z, 2)
        )

        const groundPoundRange = this.attackRange * 2.5

        if (dist <= groundPoundRange) {
            // Player caught in ground pound
            const groundPoundDamage = Math.round(this.damage * 0.6)
            const playerController = this._getPlayerController()

            if (playerController && typeof playerController.takeDamage === 'function') {
                playerController.takeDamage(groundPoundDamage, this)
            }
        }
    }

    _getPlayerController() {
        if (!this._player) return null
        const {EntityComponentPlugin} = require('threepipe')
        return EntityComponentPlugin.GetComponent(this._player, 'PlayerController')
    }

    onDeath() {
        super.onDeath()
    }

    // UI Config
    uiConfig = {
        type: 'folder',
        label: 'GoliathController',
        children: [
            {
                type: 'button',
                label: 'Toggle Enabled',
                onClick: this.ToggleEnabled,
            },
            {
                type: 'button',
                label: 'Force Enrage',
                onClick: () => this._enrage(),
            },
        ],
    }
}

