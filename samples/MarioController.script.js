import {EntityComponentPlugin, Object3DComponent} from 'threepipe'

/**
 * MarioController - Controls player movement left/right on X-axis and jumping
 */
export class MarioController extends Object3DComponent {
    // StateProperties will be serialized and show up in the editor UI
    static StateProperties = ['enabled', 'moveSpeed', 'jumpForce', 'maxSpeed']
    // ComponentType is used to uniquely identify this component type
    static ComponentType = 'MarioController'

    enabled = true
    moveSpeed = 5
    jumpForce = 8
    maxSpeed = 5

    keymap = {}
    body = null
    isGrounded = false
    _gameManager = null

    get gameManager() {
        if (!this._gameManager) {
            // Find GameManager in the scene
            const obj = this.ctx.viewer.scene.getObjectByName('GameManager')
            this._gameManager = EntityComponentPlugin.GetComponent(obj, 'GameManager')
        }
        if (!this._gameManager) {
            console.warn('[MarioController] No GameManager found in scene')
        }
        return this._gameManager
    }

    onKeyDown = (event) => {
        this.keymap[event.code] = true
    }

    onKeyUp = (event) => {
        this.keymap[event.code] = false
    }

    start() {
        // Get the Cannon3DBodyComponent (physics body) attached to this object
        const body = EntityComponentPlugin.GetComponent(this.object, 'Cannon3DBodyComponent')?.body
        console.log('[MarioController] Initialized with body:', body)

        if (!body) {
            console.warn('[MarioController] No Cannon3DBodyComponent found on object', this.object)
            return
        }

        this.body = body

        // Add keyboard event listeners
        document.addEventListener('keydown', this.onKeyDown)
        document.addEventListener('keyup', this.onKeyUp)

        // Listen for collision events to detect ground contact
        this.body.addEventListener('collide', this.onCollide)
    }

    stop() {
        // Clean up event listeners
        document.removeEventListener('keydown', this.onKeyDown)
        document.removeEventListener('keyup', this.onKeyUp)
        if (this.body) {
            this.body.removeEventListener('collide', this.onCollide)
        }
        this.body = null
    }

    onCollide = (event) => {
        // Detect collision with ground
        const objectName = event.body?.name || event.body?.id || 'unknown'
        // console.log('[MarioController] Collided with:', objectName)
    }

    onBeginContact = (event) => {
        if (!this.enabled) return

        const objectName = event.object?.name?.toLowerCase() || ''

        // Check if we're touching the ground
        if (objectName.startsWith('ground')) {
            this.isGrounded = true
        }

        console.log(objectName)
        // Increment score when colliding with collectable objects
        if (objectName.startsWith('collect')) {
            const gameManager = this.gameManager
            if (gameManager) {
                gameManager.addScore(10)
                console.log('[MarioController] Score incremented:', gameManager.score)
            }
        }
    }

    onEndContact = (event) => {
        const objectName = event.object?.name?.toLowerCase() || ''

        // Check if we're leaving the ground
        if (objectName.startsWith('ground')) {
            this.isGrounded = false
        }
    }

    update({time, deltaTime}) {
        if (!this.enabled) return
        if (!this.body) return

        console.log(this.isGrounded)

        // Left/Right movement on X-axis
        let moveDirection = 0

        if (this.keymap['ArrowLeft'] || this.keymap['KeyA']) {
            moveDirection = -1
        }
        if (this.keymap['ArrowRight'] || this.keymap['KeyD']) {
            moveDirection = 1
        }

        // Apply horizontal movement force
        if (moveDirection !== 0) {
            const targetVelocityX = moveDirection * this.moveSpeed

            // Clamp to max speed
            if (Math.abs(targetVelocityX) > this.maxSpeed) {
                this.body.velocity.x = Math.sign(targetVelocityX) * this.maxSpeed
            } else {
                this.body.velocity.x = targetVelocityX
            }
        } else {
            // Apply damping when no input
            this.body.velocity.x *= 0.8
        }

        // Jump when grounded and jump key pressed
        if (this.isGrounded && (this.keymap['Space'])) {
            // Check if vertical velocity is near zero (confirms on ground)
            this.body.velocity.y = this.jumpForce
        }

        // Move camera with player on X-axis
        const camera = this.ctx.viewer.scene.mainCamera
        if (camera) {
            camera.position.x = this.object.position.x
            camera.target.x = this.object.position.x
        }

        return true // to set viewer dirty
    }

    // UI Button to toggle controller
    ToggleEnabled = () => {
        this.enabled = !this.enabled
    }

    uiConfig = {
        type: 'folder',
        label: 'MarioController',
        children: [{
            type: 'button',
            label: 'Toggle Enabled',
            onClick: this.ToggleEnabled,
        }],
    }
}
