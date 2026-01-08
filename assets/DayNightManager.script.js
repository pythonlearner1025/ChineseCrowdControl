import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * DayNightManager - Manages day/night cycle, lighting, and enemy spawning
 * Singleton component - should only have one in the scene
 *
 * Lighting from PRD:
 * - Day: DirectionalLight 1.0, AmbientLight 0.4
 * - Night: DirectionalLight 0.2, AmbientLight 0.1
 */
export class DayNightManager extends Object3DComponent {
    static StateProperties = [
        'isDay', 'countdownDuration', 'autoEndNight',
        'dayDirectionalIntensity', 'dayAmbientIntensity',
        'nightDirectionalIntensity', 'nightAmbientIntensity',
        'lightTransitionDuration'
    ]
    static ComponentType = 'DayNightManager'

    // State
    isDay = true
    isTransitioning = false
    countdownDuration = 5000  // 5 seconds in milliseconds
    autoEndNight = true  // automatically end night when all enemies dead

    // Lighting settings (from PRD section 15)
    dayDirectionalIntensity = 1.0
    dayAmbientIntensity = 0.4
    nightDirectionalIntensity = 0.2
    nightAmbientIntensity = 0.1
    lightTransitionDuration = 1000 // ms for smooth transition

    // Environment colors
    _dayBackgroundColor = 0x87CEEB  // Light sky blue
    _nightBackgroundColor = 0x0E1116  // Dark asphalt from PRD
    _dayDirectionalColor = 0xffffee  // Warm sunlight
    _nightDirectionalColor = 0x6688cc  // Cool moonlight

    // Internal state
    _spaceKeyDown = false
    _spaceKeyDownTime = 0
    _countdownUI = null
    _handleKeyDown = null
    _handleKeyUp = null
    _enemyCount = 0

    // Light references
    _directionalLight = null
    _ambientLight = null
    _lightTransitionStart = 0
    _isLightTransitioning = false
    _startDirectionalIntensity = 0
    _startAmbientIntensity = 0
    _targetDirectionalIntensity = 0
    _targetAmbientIntensity = 0
    _startBackgroundColor = null
    _targetBackgroundColor = null
    _startDirectionalColor = null
    _targetDirectionalColor = null

    start() {
        if (super.start) super.start()

        // Find lights in scene
        this._findLights()

        // Set initial lighting state (day)
        this._applyLightingInstant(true)

        // Bind keyboard event handlers
        this._handleKeyDown = this._onKeyDown.bind(this)
        this._handleKeyUp = this._onKeyUp.bind(this)

        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('keyup', this._handleKeyUp)
    }

    // ==================== LIGHTING SYSTEM ====================

    _findLights() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        scene.traverse((obj) => {
            if (obj.type === 'DirectionalLight' || obj.isDirectionalLight) {
                this._directionalLight = obj
            }
            if (obj.type === 'AmbientLight' || obj.isAmbientLight) {
                this._ambientLight = obj
            }
        })
    }

    /**
     * Apply lighting instantly (no transition)
     */
    _applyLightingInstant(isDay) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        if (this._directionalLight) {
            this._directionalLight.intensity = isDay ?
                this.dayDirectionalIntensity : this.nightDirectionalIntensity
            this._directionalLight.color.setHex(isDay ?
                this._dayDirectionalColor : this._nightDirectionalColor)
        }

        if (this._ambientLight) {
            this._ambientLight.intensity = isDay ?
                this.dayAmbientIntensity : this.nightAmbientIntensity
        }

        // Set background color
        if (scene.background === null || scene.background instanceof THREE.Color) {
            scene.background = new THREE.Color(isDay ?
                this._dayBackgroundColor : this._nightBackgroundColor)
        }
    }

    /**
     * Start smooth lighting transition
     */
    _startLightTransition(toDay) {
        this._isLightTransitioning = true
        this._lightTransitionStart = Date.now()

        // Store current values as start
        if (this._directionalLight) {
            this._startDirectionalIntensity = this._directionalLight.intensity
            this._startDirectionalColor = this._directionalLight.color.clone()
        }
        if (this._ambientLight) {
            this._startAmbientIntensity = this._ambientLight.intensity
        }

        const scene = this.ctx?.viewer?.scene
        if (scene && scene.background instanceof THREE.Color) {
            this._startBackgroundColor = scene.background.clone()
        } else {
            this._startBackgroundColor = new THREE.Color(
                toDay ? this._nightBackgroundColor : this._dayBackgroundColor
            )
        }

        // Set targets
        this._targetDirectionalIntensity = toDay ?
            this.dayDirectionalIntensity : this.nightDirectionalIntensity
        this._targetAmbientIntensity = toDay ?
            this.dayAmbientIntensity : this.nightAmbientIntensity
        this._targetBackgroundColor = new THREE.Color(toDay ?
            this._dayBackgroundColor : this._nightBackgroundColor)
        this._targetDirectionalColor = new THREE.Color(toDay ?
            this._dayDirectionalColor : this._nightDirectionalColor)
    }

    /**
     * Update lighting transition (called in update loop)
     */
    _updateLightTransition() {
        if (!this._isLightTransitioning) return

        const elapsed = Date.now() - this._lightTransitionStart
        const t = Math.min(1, elapsed / this.lightTransitionDuration)

        // Ease function (smooth step)
        const eased = t * t * (3 - 2 * t)

        // Interpolate directional light
        if (this._directionalLight) {
            this._directionalLight.intensity =
                this._startDirectionalIntensity +
                (this._targetDirectionalIntensity - this._startDirectionalIntensity) * eased

            if (this._startDirectionalColor && this._targetDirectionalColor) {
                this._directionalLight.color.lerpColors(
                    this._startDirectionalColor,
                    this._targetDirectionalColor,
                    eased
                )
            }
        }

        // Interpolate ambient light
        if (this._ambientLight) {
            this._ambientLight.intensity =
                this._startAmbientIntensity +
                (this._targetAmbientIntensity - this._startAmbientIntensity) * eased
        }

        // Interpolate background color
        const scene = this.ctx?.viewer?.scene
        if (scene && this._startBackgroundColor && this._targetBackgroundColor) {
            if (!scene.background || !(scene.background instanceof THREE.Color)) {
                scene.background = new THREE.Color()
            }
            scene.background.lerpColors(
                this._startBackgroundColor,
                this._targetBackgroundColor,
                eased
            )
        }

        // Check if transition complete
        if (t >= 1) {
            this._isLightTransitioning = false
        }
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

        this.isTransitioning = true
        this._removeCountdownUI()

        // Start lighting transition to night
        this._startLightTransition(false)

        // Find and trigger all spawners
        const spawners = this._findAllSpawners()

        let totalEnemies = 0
        for (const spawner of spawners) {
            if (spawner.enabled && typeof spawner.spawn === 'function') {
                spawner.spawn()
                totalEnemies += spawner.spawnCount || 0
            }
        }

        this._enemyCount = totalEnemies

        this.isDay = false
        this.isTransitioning = false

        // Show night start message with dramatic styling
        this._showMessage('NIGHT PHASE', 2000, '#ff4444')
    }

    endNight() {
        if (this.isDay || this.isTransitioning) return

        this.isTransitioning = true

        // Start lighting transition to day
        this._startLightTransition(true)

        this.isDay = true
        this.isTransitioning = false
        this._enemyCount = 0

        // Show day start message
        this._showMessage('DAY PHASE', 2000, '#44ff44')
    }

    _findAllSpawners() {
        const spawners = []
        const scene = this.ctx?.viewer?.scene
        if (!scene) return spawners

        // Find all spawner components
        scene.traverse((obj) => {
            // Check for CrowdController (main enemy spawner)
            const crowdController = EntityComponentPlugin.GetComponent(obj, 'CrowdController')
            if (crowdController) spawners.push(crowdController)

            // Check for EVSpawner
            const evSpawner = EntityComponentPlugin.GetComponent(obj, 'EVSpawner')
            if (evSpawner) spawners.push(evSpawner)
        })

        return spawners
    }

    _countAliveEnemies() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return 0

        let count = 0

        // Count CrowdController members
        scene.traverse((obj) => {
            const crowdController = EntityComponentPlugin.GetComponent(obj, 'CrowdController')
            if (crowdController && crowdController._members) {
                count += crowdController._members.filter(m => m.isAlive).length
            }

            // Also check EnemySystemManager
            const enemyManager = EntityComponentPlugin.GetComponent(obj, 'EnemySystemManager')
            if (enemyManager && enemyManager._enemies) {
                count += enemyManager._enemies.filter(e => e.isAlive).length
            }

            // Legacy: individual enemy components
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

    _showMessage(text, duration = 2000, color = '#ffffff') {
        const messageDiv = document.createElement('div')
        messageDiv.style.position = 'fixed'
        messageDiv.style.top = '20%'
        messageDiv.style.left = '50%'
        messageDiv.style.transform = 'translate(-50%, -50%)'
        messageDiv.style.fontSize = '80px'
        messageDiv.style.fontWeight = 'bold'
        messageDiv.style.color = color
        messageDiv.style.textAlign = 'center'
        messageDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'
        messageDiv.style.padding = '30px 60px'
        messageDiv.style.borderRadius = '15px'
        messageDiv.style.zIndex = '9998'
        messageDiv.style.textShadow = `0 0 20px ${color}`
        messageDiv.style.border = `3px solid ${color}`
        messageDiv.textContent = text

        const container = this.ctx?.viewer?.container || document.body
        container.appendChild(messageDiv)

        // Fade out animation
        setTimeout(() => {
            messageDiv.style.transition = 'opacity 0.3s ease-out'
            messageDiv.style.opacity = '0'
            setTimeout(() => {
                messageDiv.remove()
            }, 300)
        }, duration - 300)
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        if (!this.object) return false

        // Update lighting transition
        this._updateLightTransition()

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
                this.endNight()
                return true
            }

            // Check if all enemies dead
            const aliveEnemies = this._countAliveEnemies()
            if (aliveEnemies === 0 && this._enemyCount > 0) {
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
