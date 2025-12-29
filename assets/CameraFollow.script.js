import {Object3DComponent} from 'threepipe'

/**
 * Isometric camera controller that follows a target object
 * with three zoom levels cyclable with Z key
 */
export class CameraFollow extends Object3DComponent {
    static StateProperties = ['currentZoomLevel', 'smoothing', 'offsetX', 'offsetY', 'offsetZ']
    static ComponentType = 'CameraFollow'

    target = null // Automatically found by name "Player"
    currentZoomLevel = 1 // 0, 1, or 2
    smoothing = 0.1 // Camera follow smoothness (0-1, higher = faster)

    // Additional offset from calculated position
    offsetX = 0
    offsetY = 0
    offsetZ = 0

    // Isometric angle (45 degrees looking down)
    isometricAngle = Math.PI / 4 // 45 degrees

    // Three zoom levels - distance from target
    zoomLevels = [
        { distance: 8, height: 8 },   // Close
        { distance: 12, height: 12 }, // Medium
        { distance: 16, height: 16 }  // Far
    ]

    start() {
        if (super.start) super.start()
        this._handleKeyDown = this._handleKeyDown.bind(this)
        window.addEventListener('keydown', this._handleKeyDown)
    }

    stop() {
        if (super.stop) super.stop()
        window.removeEventListener('keydown', this._handleKeyDown)
    }

    _handleKeyDown(event) {
        if (event.key.toLowerCase() === 'z') {
            this.currentZoomLevel = (this.currentZoomLevel + 1) % 3
        }
    }

    update(params) {
        try {
            if (!this.object) return false

            // Find the Player object if we don't have it yet
            if (!this.target) {
                this.target = this.ctx.viewer.scene.getObjectByName('player')
                if (!this.target) {
                    return false // Player not found yet
                }
            }

            const zoom = this.zoomLevels[this.currentZoomLevel]

            // Calculate isometric camera position
            // Position camera aligned with world axes
            const targetX = this.target.position.x
            const targetZ = this.target.position.z
            const targetY = this.target.position.y || 0

            // Isometric offset - camera positioned 45 degrees to the left
            // This places camera along the +Z axis looking down at the target
            const baseOffsetX = 0
            const baseOffsetZ = zoom.distance
            const baseOffsetY = zoom.height

            //console.log('[CameraFollow] Offset:', this.offsetX, this.offsetY, this.offsetZ)

            // Desired camera position (with custom offset)
            const desiredX = targetX + baseOffsetX + this.offsetX
            const desiredY = targetY + baseOffsetY + this.offsetY
            const desiredZ = targetZ + baseOffsetZ + this.offsetZ

            // Smooth follow using lerp
            this.object.position.x += (desiredX - this.object.position.x) * this.smoothing
            this.object.position.y += (desiredY - this.object.position.y) * this.smoothing
            this.object.position.z += (desiredZ - this.object.position.z) * this.smoothing

            // Always look at the target
            this.object.lookAt(targetX, targetY, targetZ)

            return true // Always update viewer
        } catch (error) {
            return false
        }
    }

    uiConfig = {
        type: 'folder',
        label: 'Camera Follow',
        children: [
            {
                type: 'slider',
                property: 'currentZoomLevel',
                label: 'Zoom Level',
                min: 0,
                max: 2,
                step: 1
            },
            {
                type: 'slider',
                property: 'smoothing',
                label: 'Smoothing',
                min: 0.01,
                max: 1,
                step: 0.01
            }
        ],
    }
}

