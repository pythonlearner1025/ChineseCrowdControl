import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'

/**
 * FriendlyUnitData - Lightweight data-only component for friendly units
 *
 * This component stores ONLY data/attributes - NO UPDATE LOGIC.
 * All behavior is handled by FriendlyUnitSystemManager.
 *
 * Works for: soldiers, robot tires, humanoid police, FPV drones, etc.
 */
export class FriendlyUnitData extends Object3DComponent {
    static StateProperties = [
        'unitType', 'enabled', 'health', 'maxHealth', 'armor', 'damage',
        'detectionRange', 'attackRange', 'speed', 'mass', 'friction',
        'collisionRadius', 'impactDamageScale'
    ]
    static ComponentType = 'FriendlyUnitData'

    // Unit type identifier
    unitType = 'soldier' // 'soldier', 'robotTire', 'humanoidPolice', 'fpvDrone'

    // Core attributes
    enabled = true
    health = 50
    maxHealth = 50
    armor = 2
    damage = 10

    // Auto-attack attributes
    detectionRange = 25  // how far they can detect enemies
    attackRange = 2      // melee range

    // Physics attributes (for cannon-es)
    speed = 8
    mass = 10.0
    friction = 3
    collisionRadius = 1.5

    // Impact damage
    impactDamageScale = 5.0

    // === RUNTIME STATE (not serialized) ===
    // Managed by FriendlyUnitSystemManager
    _isAlive = true
    _isSelected = false
    _groupId = null
    _targetPosition = null
    _userTargetPosition = null
    _velocity = null
    _autoTargetEnemy = null
    _displayedHealth = 50
    _selectionRing = null
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null
    _physicsBody = null  // Cannon-es body

    // Getters
    get isAlive() {
        return this._isAlive && this.health > 0
    }

    get isSelected() {
        return this._isSelected
    }

    get groupId() {
        return this._groupId
    }

    // Lifecycle
    init(object, state) {
        super.init(object, state)
        this._velocity = new THREE.Vector3(0, 0, 0)
        this._displayedHealth = this.health
        this._isAlive = true
        this._isSelected = false
        this._groupId = null
        this._targetPosition = null
        this._userTargetPosition = null
        this._autoTargetEnemy = null
    }

    destroy() {
        this._velocity = null
        this._targetPosition = null
        this._userTargetPosition = null
        this._physicsBody = null
        return super.destroy()
    }

    // Combat
    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return

        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage

        if (this.health <= 0) {
            this._isAlive = false
        }
    }

    // Selection
    select() {
        this._isSelected = true
    }

    deselect() {
        this._isSelected = false
    }

    setGroup(groupId) {
        this._groupId = groupId
    }

    clearGroup() {
        this._groupId = null
    }

    // Movement commands
    moveTo(position) {
        this._userTargetPosition = position.clone()
        this._targetPosition = position.clone()
        this._autoTargetEnemy = null
    }

    stopMoving() {
        this._targetPosition = null
        this._userTargetPosition = null
        this._autoTargetEnemy = null
    }

    // Animation helpers
    getAnimationScale() {
        switch(this.unitType) {
            case 'robotTire': return 0.8
            case 'humanoidPolice': return 1.0
            case 'fpvDrone': return 0.6
            default: return 1.0
        }
    }

    getAnimationColor() {
        switch(this.unitType) {
            case 'robotTire': return 0x44ff44  // green
            case 'humanoidPolice': return 0x4444ff  // blue
            case 'fpvDrone': return 0xffaa00  // orange
            default: return 0x4444ff  // blue
        }
    }
}
