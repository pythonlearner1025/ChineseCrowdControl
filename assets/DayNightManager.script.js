import {Object3DComponent, EntityComponentPlugin} from 'threepipe'

/**
 * DayNightManager - Manages day/night cycle and enemy spawning
 * Singleton component - should only have one in the scene
 */
export class DayNightManager extends Object3DComponent {
    static StateProperties = [
        'isDay', 'countdownDuration', 'autoEndNight'
    ]
    static ComponentType = 'DayNightManager'

    // State
    isDay = true
    isTransitioning = false
    countdownDuration = 5000  // 5 seconds in milliseconds
    autoEndNight = true  // automatically end night when all enemies dead

    // Internal state
    _spaceKeyDown = false
    _spaceKeyDownTime = 0
    _countdownUI = null
    _handleKeyDown = null
    _handleKeyUp = null
    _enemyCount = 0

    start() {
        if (super.start) super.start()

        // Bind keyboard event handlers
        this._handleKeyDown = this._onKeyDown.bind(this)
        this._handleKeyUp = this._onKeyUp.bind(this)

        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('keyup', this._handleKeyUp)

        //console.log('[DayNightManager] Started - Press and hold SPACE for 5 seconds to start night')
    }

    stop() {
        if (super.stop) super.stop()

        window.removeEventListener('keydown', this._handleKeyDown)
        window.removeEventListener('keyup', this._handleKeyUp)

        this._removeCountdownUI()
    }

    // ==================== KEYBOARD INPUT ====================

    _onKeyDown(event) {
        if (event.code === 'Space' && !this._spaceKeyDown && this.isDay && !this.isTransitioning) {
            this._spaceKeyDown = true
            this._spaceKeyDownTime = Date.now()
            this._createCountdownUI()
        }
    }

    _onKeyUp(event) {
        if (event.code === 'Space' && this._spaceKeyDown) {
            this._spaceKeyDown = false
            this._spaceKeyDownTime = 0
            this._removeCountdownUI()
            //console.log('[DayNightManager] Night start cancelled')
        }
    }

    // ==================== COUNTDOWN UI ====================

    _createCountdownUI() {
        // Remove existing UI if any
        this._removeCountdownUI()

        // Create countdown overlay
        this._countdownUI = document.createElement('div')
        this._countdownUI.style.position = 'fixed'
        this._countdownUI.style.top = '50%'
        this._countdownUI.style.left = '50%'
        this._countdownUI.style.transform = 'translate(-50%, -50%)'
        this._countdownUI.style.fontSize = '120px'
        this._countdownUI.style.fontWeight = 'bold'
        this._countdownUI.style.color = '#ff0000'
        this._countdownUI.style.textAlign = 'center'
        this._countdownUI.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'
        this._countdownUI.style.padding = '60px 120px'
        this._countdownUI.style.borderRadius = '20px'
        this._countdownUI.style.zIndex = '9999'
        this._countdownUI.style.textShadow = '0 0 20px rgba(255, 0, 0, 0.8)'
        this._countdownUI.style.border = '4px solid #ff0000'
        this._countdownUI.textContent = '5'

        document.body.appendChild(this._countdownUI)
    }

    _updateCountdownUI(secondsLeft) {
        if (!this._countdownUI) return

        this._countdownUI.textContent = Math.ceil(secondsLeft).toString()

        // Pulse effect as time runs out
        const scale = 1 + (1 - secondsLeft / 5) * 0.2
        this._countdownUI.style.transform = `translate(-50%, -50%) scale(${scale})`
    }

    _removeCountdownUI() {
        if (this._countdownUI) {
            document.body.removeChild(this._countdownUI)
            this._countdownUI = null
        }
    }

    // ==================== NIGHT/DAY CYCLE ====================

    startNight() {
        if (!this.isDay || this.isTransitioning) {
            console.warn('[DayNightManager] Cannot start night - already night or transitioning')
            return
        }

        //console.log('[DayNightManager] ========================================')
        //console.log('[DayNightManager] NIGHT BEGINS!')
        //console.log('[DayNightManager] ========================================')
        this.isTransitioning = true
        this._removeCountdownUI()

        // Find and trigger all spawners
        const spawners = this._findAllSpawners()
        //console.log(`[DayNightManager] Found ${spawners.length} spawners:`)

        let totalEnemies = 0
        for (const spawner of spawners) {
            const spawnerType = spawner.constructor.name
            //console.log(`  - ${spawnerType}: enabled=${spawner.enabled}, spawnCount=${spawner.spawnCount}`)

            if (spawner.enabled && typeof spawner.spawn === 'function') {
                //console.log(`  → Triggering ${spawnerType}.spawn()...`)
                spawner.spawn()
                totalEnemies += spawner.spawnCount || 0
            } else {
                console.warn(`  ✗ Skipping ${spawnerType} (disabled or no spawn method)`)
            }
        }

        this._enemyCount = totalEnemies
        //console.log(`[DayNightManager] Total expected enemies: ${totalEnemies}`)
        //console.log('[DayNightManager] ========================================')

        this.isDay = false
        this.isTransitioning = false

        // Show night start message
        this._showMessage('NIGHT PHASE', 2000)
    }

    endNight() {
        if (this.isDay || this.isTransitioning) return

        //console.log('[DayNightManager] NIGHT ENDS - Day begins')
        this.isTransitioning = true

        this.isDay = true
        this.isTransitioning = false
        this._enemyCount = 0

        // Show day start message
        this._showMessage('DAY PHASE', 2000)
    }

    _findAllSpawners() {
        const spawners = []
        const scene = this.ctx?.viewer?.scene
        if (!scene) return spawners

        // Find all spawner components
        scene.traverse((obj) => {
            // Check for each spawner type
            const evSpawner = EntityComponentPlugin.GetComponent(obj, 'EVSpawner')

            if (evSpawner) spawners.push(evSpawner)
        })

        return spawners
    }

    _countAliveEnemies() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return 0

        let count = 0

        scene.traverse((obj) => {
            const enemy = EntityComponentPlugin.GetComponent(obj, 'BaseEnemyController') ||
                         EntityComponentPlugin.GetComponent(obj, 'EnemyData')

            if (enemy && enemy.isAlive) {
                count++
            }
        })

        return count
    }

    _checkCityHallDestroyed() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return false

        let cityHallDestroyed = false

        scene.traverse((obj) => {
            const cityHall = EntityComponentPlugin.GetComponent(obj, 'CityHall')
            if (cityHall && !cityHall.isAlive) {
                cityHallDestroyed = true
            }
        })

        return cityHallDestroyed
    }

    _showMessage(text, duration = 2000) {
        const messageDiv = document.createElement('div')
        messageDiv.style.position = 'fixed'
        messageDiv.style.top = '20%'
        messageDiv.style.left = '50%'
        messageDiv.style.transform = 'translate(-50%, -50%)'
        messageDiv.style.fontSize = '80px'
        messageDiv.style.fontWeight = 'bold'
        messageDiv.style.color = '#ffffff'
        messageDiv.style.textAlign = 'center'
        messageDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'
        messageDiv.style.padding = '30px 60px'
        messageDiv.style.borderRadius = '15px'
        messageDiv.style.zIndex = '9998'
        messageDiv.style.textShadow = '0 0 15px rgba(255, 255, 255, 0.8)'
        messageDiv.textContent = text

        document.body.appendChild(messageDiv)

        setTimeout(() => {
            document.body.removeChild(messageDiv)
        }, duration)
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        if (!this.object) return false

        // Check space key hold for countdown
        if (this._spaceKeyDown && this.isDay && !this.isTransitioning) {
            const elapsed = Date.now() - this._spaceKeyDownTime
            const remaining = this.countdownDuration - elapsed

            if (remaining > 0) {
                // Update countdown UI
                this._updateCountdownUI(remaining / 1000)
            } else {
                // Countdown complete - start night!
                this._spaceKeyDown = false
                this._spaceKeyDownTime = 0
                this.startNight()
            }
        }

        // Auto-end night when conditions met
        if (!this.isDay && !this.isTransitioning && this.autoEndNight) {
            // Check if City Hall destroyed (game over)
            if (this._checkCityHallDestroyed()) {
                //console.log('[DayNightManager] City Hall destroyed - night ends in defeat')
                this.endNight()
                return true
            }

            // Check if all enemies dead
            const aliveEnemies = this._countAliveEnemies()
            if (aliveEnemies === 0 && this._enemyCount > 0) {
                //console.log('[DayNightManager] All enemies defeated - night ends in victory!')
                this.endNight()
            }
        }

        return true
    }

    // ==================== UI CONFIG ====================

    ForceStartNight = () => {
        if (this.isDay) {
            this.startNight()
        }
    }

    ForceEndNight = () => {
        if (!this.isDay) {
            this.endNight()
        }
    }

    uiConfig = {
        type: 'folder',
        label: 'Day/Night Manager',
        children: [
            {
                type: 'button',
                label: 'Force Start Night',
                onClick: this.ForceStartNight,
            },
            {
                type: 'button',
                label: 'Force End Night',
                onClick: this.ForceEndNight,
            },
        ],
    }
}
