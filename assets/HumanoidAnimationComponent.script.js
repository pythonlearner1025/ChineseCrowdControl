import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * HumanoidAnimationComponent - Procedural humanoid animation for alive entities
 * Creates 10-body animated humanoid with walking cycle based on velocity
 * Seamlessly transitions to ragdoll physics on death
 */
export class HumanoidAnimationComponent extends Object3DComponent {
    static StateProperties = [
        'enabled', 'walkCycleSpeed', 'legSwingAngle',
        'armSwingAngle', 'torsoBobbingHeight'
    ]
    static ComponentType = 'HumanoidAnimationComponent'

    enabled = true

    // Configuration (set by parent controller)
    scale = 1.0
    color = 0xff4444
    baseSpeed = 4

    // Animation parameters
    walkCycleSpeed = 8
    legSwingAngle = Math.PI / 6  // 30 degrees
    armSwingAngle = Math.PI / 9  // 20 degrees
    torsoBobbingHeight = 0.1

    // Internal state
    _bodyParts = {}
    _animPhase = 0
    _lastDeltaTime = 0.016
    _lastPosition = null
    _rootObject = null

    start() {
        if (super.start) super.start()

        // Hide original parent mesh (capsule)
        if (this.object) {
            this.object.visible = false
        }

        //console.log('[HumanoidAnimationComponent] Started - waiting for body parts from parent controller')
    }

    stop() {
        if (super.stop) super.stop()
        // Note: Body parts are NOT cleaned up here
        // Cleanup is handled by the parent controller (BaseEnemyController/CrowdController)
        this._clearReferences()
    }

    update({time, deltaTime}) {
        if (!this.enabled || !this._rootObject) return false

        // Calculate velocity from parent controller
        const velocity = this._calculateVelocity()
        const speed = velocity.length()

        // Update animation phase based on velocity
        if (speed > 0.1) {
            const dt = deltaTime / 1000
            this._animPhase += dt * this.walkCycleSpeed * (speed / this.baseSpeed)
            this._animPhase = this._animPhase % (Math.PI * 2) // Keep in 0-2π range
        } else {
            // Idle: slowly return to T-pose
            this._animPhase *= 0.9
        }

        // Apply procedural animation to limbs
        this._animateLimbs(this._animPhase, velocity)

        // Update root object position to follow parent
        if (this.object) {
            const worldPos = new THREE.Vector3()
            this.object.getWorldPosition(worldPos)
            this._rootObject.position.copy(worldPos)
            this._rootObject.rotation.y = this.object.rotation.y
        }

        // Store delta time for velocity calculation
        this._lastDeltaTime = deltaTime / 1000

        return true
    }

    /**
     * Set body parts created by the parent controller
     * @param {Object} bodyParts - Dictionary of body parts with mesh and metadata
     * @param {THREE.Group} rootObject - Root object containing all body parts
     */
    setBodyParts(bodyParts, rootObject) {
        this._bodyParts = bodyParts
        this._rootObject = rootObject
        //console.log('[HumanoidAnimationComponent] Received', Object.keys(bodyParts).length, 'body parts from parent')
    }

    _animateLimbs(phase, velocity) {
        if (!this._bodyParts.head) return

        const speed = velocity.length()
        const isWalking = speed > 0.1

        // Get body parts
        const head = this._bodyParts.head
        const torso = this._bodyParts.torso
        const upperArmLeft = this._bodyParts.upperArmLeft
        const lowerArmLeft = this._bodyParts.lowerArmLeft
        const upperArmRight = this._bodyParts.upperArmRight
        const lowerArmRight = this._bodyParts.lowerArmRight
        const upperLegLeft = this._bodyParts.upperLegLeft
        const lowerLegLeft = this._bodyParts.lowerLegLeft
        const upperLegRight = this._bodyParts.upperLegRight
        const lowerLegRight = this._bodyParts.lowerLegRight

        if (isWalking) {
            // Calculate swing angles
            const leftLegSwing = Math.sin(phase) * this.legSwingAngle
            const rightLegSwing = -Math.sin(phase) * this.legSwingAngle
            const leftArmSwing = -Math.sin(phase) * this.armSwingAngle
            const rightArmSwing = Math.sin(phase) * this.armSwingAngle

            // Torso bobbing (2x frequency for natural gait)
            const torsoY = Math.abs(Math.sin(phase * 2)) * this.torsoBobbingHeight
            torso.mesh.position.y = torso.baseOffset.y + torsoY
            torso.mesh.rotation.x = 0.05 // Slight lean forward

            // Head follows torso
            head.mesh.position.y = head.baseOffset.y + torsoY
            head.mesh.rotation.y = -Math.sin(phase) * 0.05 // Slight counter-rotation

            // Left leg (hip rotation)
            upperLegLeft.mesh.rotation.x = leftLegSwing
            upperLegLeft.mesh.position.y = upperLegLeft.baseOffset.y + Math.sin(phase) * 0.05 * this.scale

            // Left knee (only bends forward)
            const leftKneeBend = Math.max(0, -Math.sin(phase) * this.legSwingAngle * 0.5)
            lowerLegLeft.mesh.rotation.x = leftKneeBend
            lowerLegLeft.mesh.position.y = lowerLegLeft.baseOffset.y

            // Right leg (hip rotation)
            upperLegRight.mesh.rotation.x = rightLegSwing
            upperLegRight.mesh.position.y = upperLegRight.baseOffset.y - Math.sin(phase) * 0.05 * this.scale

            // Right knee (only bends forward)
            const rightKneeBend = Math.max(0, Math.sin(phase) * this.legSwingAngle * 0.5)
            lowerLegRight.mesh.rotation.x = rightKneeBend
            lowerLegRight.mesh.position.y = lowerLegRight.baseOffset.y

            // Left arm (shoulder rotation)
            upperArmLeft.mesh.rotation.x = leftArmSwing
            upperArmLeft.mesh.position.copy(upperArmLeft.baseOffset)

            // Left elbow (slight bend)
            lowerArmLeft.mesh.rotation.x = Math.sin(phase) * this.armSwingAngle * 0.3
            lowerArmLeft.mesh.position.copy(lowerArmLeft.baseOffset)

            // Right arm (shoulder rotation)
            upperArmRight.mesh.rotation.x = rightArmSwing
            upperArmRight.mesh.position.copy(upperArmRight.baseOffset)

            // Right elbow (slight bend)
            lowerArmRight.mesh.rotation.x = -Math.sin(phase) * this.armSwingAngle * 0.3
            lowerArmRight.mesh.position.copy(lowerArmRight.baseOffset)

        } else {
            // Idle: T-pose (lerp back to zero rotation)
            const lerpFactor = 0.1

            torso.mesh.position.lerp(torso.baseOffset, lerpFactor)
            torso.mesh.rotation.x *= (1 - lerpFactor)

            head.mesh.position.lerp(head.baseOffset, lerpFactor)
            head.mesh.rotation.y *= (1 - lerpFactor)

            upperLegLeft.mesh.rotation.x *= (1 - lerpFactor)
            upperLegLeft.mesh.position.lerp(upperLegLeft.baseOffset, lerpFactor)
            lowerLegLeft.mesh.rotation.x *= (1 - lerpFactor)

            upperLegRight.mesh.rotation.x *= (1 - lerpFactor)
            upperLegRight.mesh.position.lerp(upperLegRight.baseOffset, lerpFactor)
            lowerLegRight.mesh.rotation.x *= (1 - lerpFactor)

            upperArmLeft.mesh.rotation.x *= (1 - lerpFactor)
            lowerArmLeft.mesh.rotation.x *= (1 - lerpFactor)

            upperArmRight.mesh.rotation.x *= (1 - lerpFactor)
            lowerArmRight.mesh.rotation.x *= (1 - lerpFactor)
        }
    }

    _calculateVelocity() {
        // Strategy 1: Try to get velocity from CrowdController
        const parentObj = this.object?.parent
        if (parentObj) {
            const crowdController = EntityComponentPlugin.GetComponent(parentObj, 'CrowdController')
            if (crowdController && crowdController._members) {
                const member = crowdController._members.find(m => m.mesh === this.object)
                if (member && member.velocity) {
                    return member.velocity.clone()
                }
            }
        }

        // Strategy 2: Try to get velocity from BaseEnemyController or subclasses
        if (this.object) {
            // Try BaseEnemyController
            let controller = EntityComponentPlugin.GetComponent(this.object, 'BaseEnemyController')
            if (controller && controller._velocity) {
                return controller._velocity.clone()
            }
        }

        // Strategy 3: Fallback - calculate from position delta
        if (this.object && this._lastPosition) {
            const currentPos = new THREE.Vector3()
            this.object.getWorldPosition(currentPos)

            const velocity = new THREE.Vector3()
            velocity.subVectors(currentPos, this._lastPosition)
            velocity.divideScalar(this._lastDeltaTime || 0.016)

            this._lastPosition.copy(currentPos)
            return velocity
        }

        // First frame: initialize
        if (this.object && !this._lastPosition) {
            this._lastPosition = new THREE.Vector3()
            this.object.getWorldPosition(this._lastPosition)
        }

        return new THREE.Vector3(0, 0, 0)
    }

    /**
     * Export body states for seamless ragdoll transition
     * Returns object with body part positions, rotations, and velocities
     */
    getBodyStates() {
        const states = {}

        for (const [name, part] of Object.entries(this._bodyParts)) {
            const worldPos = new THREE.Vector3()
            const worldQuat = new THREE.Quaternion()

            part.mesh.getWorldPosition(worldPos)
            part.mesh.getWorldQuaternion(worldQuat)

            // Calculate velocity from position delta
            const velocity = new THREE.Vector3()
            if (part.prevPosition) {
                velocity.subVectors(worldPos, part.prevPosition)
                velocity.divideScalar(this._lastDeltaTime || 0.016)
            }

            states[name] = {
                position: worldPos.clone(),
                quaternion: worldQuat.clone(),
                velocity: velocity.clone()
            }

            // Store for next frame
            part.prevPosition = worldPos.clone()
        }

        return states
    }

    /**
     * Clear internal references only - does NOT destroy body parts
     * Body part cleanup is handled by the parent controller
     */
    _clearReferences() {
        this._bodyParts = {}
        this._rootObject = null
        //console.log('[HumanoidAnimationComponent] Cleared references')
    }
}
