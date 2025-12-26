import {EntityComponentPlugin, Object3DComponent} from 'threepipe'

/**
 * GameManager - Manages game state, score, and time display
 */
export class GameManager extends Object3DComponent {
    static StateProperties = ['score', 'gameState']
    static ComponentType = 'GameManager'

    score = 0
    gameState = 'playing' // 'playing', 'paused', 'gameover'

    _hudDiv = null
    _scoreDiv = null
    _timeDiv = null
    _startTime = 0
    _elapsedTime = 0

    start() {
        // Create HUD container at the top of the screen
        this._hudDiv = document.createElement('div')
        this._hudDiv.style.position = 'absolute'
        this._hudDiv.style.top = '20px'
        this._hudDiv.style.left = '50%'
        this._hudDiv.style.transform = 'translateX(-50%)'
        this._hudDiv.style.display = 'flex'
        this._hudDiv.style.gap = '40px'
        this._hudDiv.style.color = 'white'
        this._hudDiv.style.fontSize = '24px'
        this._hudDiv.style.fontFamily = 'Arial, sans-serif'
        this._hudDiv.style.fontWeight = 'bold'
        this._hudDiv.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)'
        this._hudDiv.style.pointerEvents = 'none'
        this._hudDiv.style.zIndex = '1000'

        // Create score display
        this._scoreDiv = document.createElement('div')
        this._scoreDiv.textContent = `Score: ${this.score}`
        this._hudDiv.appendChild(this._scoreDiv)

        // Create time display
        this._timeDiv = document.createElement('div')
        this._timeDiv.textContent = 'Time: 0.0s'
        this._hudDiv.appendChild(this._timeDiv)

        this.ctx.viewer.container.appendChild(this._hudDiv)

        // Record start time
        this._startTime = Date.now()
        this._elapsedTime = 0

        console.log('[GameManager] Started')
    }

    stop() {
        // Remove the HUD div
        if (this._hudDiv && this._hudDiv.parentNode) {
            this._hudDiv.parentNode.removeChild(this._hudDiv)
        }
        this._hudDiv = null
        this._scoreDiv = null
        this._timeDiv = null
    }

    update({time, deltaTime}) {
        if (!this._timeDiv) return

        // Update elapsed time if game is playing
        if (this.gameState === 'playing') {
            this._elapsedTime = (Date.now() - this._startTime) / 1000
            this._timeDiv.textContent = `Time: ${this._elapsedTime.toFixed(1)}s`
        }

        return false // don't need to set viewer dirty for HUD updates
    }

    // Public methods to modify score
    addScore(points) {
        this.score += points
        if (this._scoreDiv) {
            this._scoreDiv.textContent = `Score: ${this.score}`
        }
        console.log(`[GameManager] Score: ${this.score} (+${points})`)
    }

    resetScore() {
        this.score = 0
        if (this._scoreDiv) {
            this._scoreDiv.textContent = `Score: ${this.score}`
        }
    }

    // Game state management
    pauseGame() {
        this.gameState = 'paused'
        console.log('[GameManager] Game paused')
    }

    resumeGame() {
        this.gameState = 'playing'
        console.log('[GameManager] Game resumed')
    }

    gameOver() {
        this.gameState = 'gameover'
        console.log(`[GameManager] Game Over! Final Score: ${this.score}, Time: ${this._elapsedTime.toFixed(1)}s`)
    }

    restartGame() {
        this.gameState = 'playing'
        this.resetScore()
        this._startTime = Date.now()
        this._elapsedTime = 0
        console.log('[GameManager] Game restarted')
    }

    getElapsedTime() {
        return this._elapsedTime
    }

    // UI Config for editor
    uiConfig = {
        type: 'folder',
        label: 'GameManager',
        children: [
            {
                type: 'button',
                label: 'Add 10 Points',
                onClick: () => this.addScore(10),
            },
            {
                type: 'button',
                label: 'Reset Score',
                onClick: () => this.resetScore(),
            },
            {
                type: 'button',
                label: 'Restart Game',
                onClick: () => this.restartGame(),
            },
        ],
    }
}

