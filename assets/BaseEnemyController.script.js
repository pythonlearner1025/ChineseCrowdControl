import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * BaseEnemyController - Base class for all enemy types with A* pathfinding
 */
export class BaseEnemyController extends Object3DComponent {
    static StateProperties = [
        'enabled', 'name', 'health', 'maxHealth', 'speed', 'armor',
        'attackRange', 'detectionRange', 'damage', 'attackFrequency', 'knockbackResistance',
        'mass', 'friction'
    ]
    static ComponentType = 'BaseEnemyController'

    // Core attributes
    enabled = true
    name = 'Enemy'
    health = 100
    maxHealth = 100
    speed = 6
    armor = 0
    attackRange = 2       // melee attack distance
    detectionRange = 15   // how far can detect player
    damage = 10
    attackFrequency = 1   // attacks per second
    knockbackResistance = 0.2

    // Physics attributes
    mass = 1.5            // enemies are slightly heavier
    friction = 6          // how fast they stop

    // Internal state
    _player = null
    _lastAttackTime = 0
    _isAlive = true
    _path = []
    _pathIndex = 0
    _lastPathUpdate = 0
    _pathUpdateInterval = 500 // ms between path recalculations

    // Physics state
    _velocity = null
    _displayedHealth = 100

    // Animation
    _animComp = null

    // Health bar
    _healthBarGroup = null
    _healthBarFill = null
    _healthBarBg = null
    _healthBarOffset = 2.5

    // A* grid settings
    _gridSize = 1      // size of each grid cell
    _gridRange = 50    // how far the grid extends

    get isAlive() {
        return this._isAlive && this.health > 0
    }

    start() {
        if (super.start) super.start()
        this._lastAttackTime = 0
        this._findPlayer()

        // Initialize physics
        this._velocity = new THREE.Vector3(0, 0, 0)
        this._displayedHealth = this.health

        // Create health bar
        this._createHealthBar()

        // Setup humanoid animation
        this._setupAnimation()
    }

    stop() {
        if (super.stop) super.stop()
        this._player = null
        this._path = []

        // Cleanup health bar
        this._removeHealthBar()
    }

    // ==================== ANIMATION ====================

    _setupAnimation() {
        if (!this.object || !this.ctx?.ecp) return

        this.ctx.ecp.addComponent(this.object, 'HumanoidAnimationComponent')
        this._animComp = EntityComponentPlugin.GetComponent(this.object, 'HumanoidAnimationComponent')

        if (this._animComp) {
            this._animComp.scale = this._getAnimationScale()
            this._animComp.color = this._getAnimationColor()
            this._animComp.baseSpeed = this.speed
            console.log('[BaseEnemyController] Added animation component')
        }
    }

    _getAnimationScale() {
        return 1.0  // Override in subclasses (e.g., Goliath = 2.0)
    }

    _getAnimationColor() {
        return 0xff4444  // Red for base enemies
    }

    // ==================== HEALTH BAR ====================

    _createHealthBar() {
        if (!this.object) return

        const barWidth = 1.0
        const barHeight = 0.25
        this._healthBarOffset = 2.5 // height above object

        // Create group to hold health bar components
        this._healthBarGroup = new THREE.Group()
        this._healthBarGroup.name = 'EnemyHealthBar'

        // Background bar (dark)
        const bgGeometry = new THREE.PlaneGeometry(barWidth, barHeight)
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        })
        this._healthBarBg = new THREE.Mesh(bgGeometry, bgMaterial)
        this._healthBarGroup.add(this._healthBarBg)

        // Health fill bar (red for enemies)
        const fillGeometry = new THREE.PlaneGeometry(barWidth - 0.06, barHeight - 0.06)
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            side: THREE.DoubleSide
        })
        this._healthBarFill = new THREE.Mesh(fillGeometry, fillMaterial)
        this._healthBarFill.position.z = 0.01 // slightly in front
        this._healthBarGroup.add(this._healthBarFill)

        // Add to scene root (not enemy) so it doesn't rotate with enemy
        const scene = this.ctx?.viewer?.scene
        if (scene) {
            scene.add(this._healthBarGroup)
        }
    }

    _removeHealthBar() {
        if (this._healthBarGroup) {
            const scene = this.ctx?.viewer?.scene
            if (scene) {
                scene.remove(this._healthBarGroup)
            }
            this._healthBarBg?.geometry.dispose()
            this._healthBarBg?.material.dispose()
            this._healthBarFill?.geometry.dispose()
            this._healthBarFill?.material.dispose()
        }
        this._healthBarGroup = null
        this._healthBarFill = null
        this._healthBarBg = null
    }

    _updateHealthBar(deltaTime) {
        if (!this._healthBarGroup || !this._healthBarFill || !this.object) return

        // Position healthbar above enemy's world position
        const enemyWorldPos = new THREE.Vector3()
        this.object.getWorldPosition(enemyWorldPos)
        this._healthBarGroup.position.set(
            enemyWorldPos.x,
            enemyWorldPos.y + this._healthBarOffset,
            enemyWorldPos.z
        )

        // Smooth health animation
        const healthLerpSpeed = 5
        const dt = deltaTime / 1000
        this._displayedHealth += (this.health - this._displayedHealth) * Math.min(1, healthLerpSpeed * dt)

        // Update fill scale (0 to 1)
        const healthPercent = Math.max(0, this._displayedHealth / this.maxHealth)
        this._healthBarFill.scale.x = healthPercent

        // Offset to keep bar left-aligned
        const barWidth = 0.94 // fillGeometry width
        this._healthBarFill.position.x = -(barWidth / 2) * (1 - healthPercent)

        // Color gradient: red -> orange -> yellow (enemies)
        const color = new THREE.Color()
        if (healthPercent > 0.5) {
            // Full to half: red stays, add some green
            color.setRGB(1, (1 - healthPercent) * 0.6, 0.1)
        } else {
            // Half to zero: red to dark red
            color.setRGB(0.5 + healthPercent, healthPercent * 0.3, 0.1)
        }
        this._healthBarFill.material.color = color

        // Billboard: face camera
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (camera) {
            this._healthBarGroup.lookAt(camera.position)
            //this._healthBarGroup.quaternion.copy(camera.quaternion)
        }
    }

    _findPlayer() {
        // Find player object in scene
        const scene = this.ctx?.viewer?.scene
        if (!scene) return null

        // Look for object with PlayerController component
        scene.traverse((obj) => {
            if (this._player) return
            const controller = EntityComponentPlugin.GetComponent(obj, 'PlayerController')
            if (controller) {
                this._player = obj
            }
        })

        if (!this._player) {
            // Fallback: look for object named 'Player'
            this._player = scene.getObjectByName('Player')
        }

        return this._player
    }

    // ==================== A* PATHFINDING ====================

    _worldToGrid(x, z) {
        return {
            x: Math.round(x / this._gridSize),
            z: Math.round(z / this._gridSize)
        }
    }

    _gridToWorld(gx, gz) {
        return {
            x: gx * this._gridSize,
            z: gz * this._gridSize
        }
    }

    _heuristic(a, b) {
        // Manhattan distance
        return Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
    }

    _getNeighbors(node) {
        // 8-directional movement (like Minecraft zombie)
        const dirs = [
            {x: 0, z: 1}, {x: 0, z: -1}, {x: 1, z: 0}, {x: -1, z: 0},
            {x: 1, z: 1}, {x: 1, z: -1}, {x: -1, z: 1}, {x: -1, z: -1}
        ]
        return dirs.map(d => ({x: node.x + d.x, z: node.z + d.z}))
    }

    _isWalkable(gx, gz) {
        // Basic walkability check - can be overridden for obstacle avoidance
        // For now, assume all ground is walkable within grid range
        const range = this._gridRange / this._gridSize
        return Math.abs(gx) < range && Math.abs(gz) < range
    }

    _findPath(startX, startZ, endX, endZ) {
        const start = this._worldToGrid(startX, startZ)
        const end = this._worldToGrid(endX, endZ)

        // If already at destination
        if (start.x === end.x && start.z === end.z) {
            return []
        }

        const openSet = []
        const closedSet = new Set()
        const cameFrom = new Map()
        const gScore = new Map()
        const fScore = new Map()

        const key = (n) => `${n.x},${n.z}`

        openSet.push(start)
        gScore.set(key(start), 0)
        fScore.set(key(start), this._heuristic(start, end))

        let iterations = 0
        const maxIterations = 500 // prevent infinite loops

        while (openSet.length > 0 && iterations < maxIterations) {
            iterations++

            // Find node with lowest fScore
            openSet.sort((a, b) => (fScore.get(key(a)) || Infinity) - (fScore.get(key(b)) || Infinity))
            const current = openSet.shift()
            const currentKey = key(current)

            // Reached goal
            if (current.x === end.x && current.z === end.z) {
                return this._reconstructPath(cameFrom, current)
            }

            closedSet.add(currentKey)

            for (const neighbor of this._getNeighbors(current)) {
                const neighborKey = key(neighbor)

                if (closedSet.has(neighborKey)) continue
                if (!this._isWalkable(neighbor.x, neighbor.z)) continue

                // Diagonal movement costs more
                const isDiagonal = neighbor.x !== current.x && neighbor.z !== current.z
                const moveCost = isDiagonal ? 1.414 : 1
                const tentativeG = (gScore.get(currentKey) || 0) + moveCost

                const inOpen = openSet.some(n => n.x === neighbor.x && n.z === neighbor.z)
                if (!inOpen) {
                    openSet.push(neighbor)
                } else if (tentativeG >= (gScore.get(neighborKey) || Infinity)) {
                    continue
                }

                cameFrom.set(neighborKey, current)
                gScore.set(neighborKey, tentativeG)
                fScore.set(neighborKey, tentativeG + this._heuristic(neighbor, end))
            }
        }

        // No path found - return direct line
        return [end]
    }

    _reconstructPath(cameFrom, current) {
        const path = []
        const key = (n) => `${n.x},${n.z}`
        let node = current

        while (node) {
            path.unshift(this._gridToWorld(node.x, node.z))
            node = cameFrom.get(key(node))
        }

        // Skip first node (current position)
        return path.slice(1)
    }

    // ==================== COMBAT ====================

    takeDamage(amount, attacker = null) {
        if (!this.isAlive) return

        // Apply armor reduction
        const effectiveDamage = Math.max(1, amount - this.armor)
        this.health -= effectiveDamage

        if (this.health <= 0) {
            this._die(attacker)
        }
    }

    _die(attacker = null) {
        this._isAlive = false
        this.onDeath(attacker)
    }

    onDeath(attacker = null) {
        // Hide original mesh first (ensure death happens even if ragdoll fails)
        if (this.object) {
            this.object.visible = false
        }

        // Clean up animation component (CRITICAL - removes the 10 frozen body parts!)
        if (this._animComp) {
            console.log('[BaseEnemyController] Cleaning up animation component')
            this._animComp.cleanup()
            this._animComp = null
        }

        // Remove health bar
        this._removeHealthBar()

        // Try to spawn ragdoll (non-blocking)
        try {
            const worldPos = new THREE.Vector3()
            this.object.getWorldPosition(worldPos)

            // Calculate impact velocity from attacker
            let impactVelocity = new THREE.Vector3()
            if (attacker && attacker.object) {
                // Get direction from attacker to victim
                const attackerPos = new THREE.Vector3()
                attacker.object.getWorldPosition(attackerPos)
                impactVelocity.subVectors(worldPos, attackerPos).normalize()
                impactVelocity.multiplyScalar(30) // Strong impact force
                impactVelocity.y = 10 // Add upward component
            } else if (this._velocity) {
                // Fallback to enemy's own velocity
                impactVelocity = this._velocity.clone()
            }

            this._spawnRagdoll(worldPos, impactVelocity)
        } catch (error) {
            console.error('[BaseEnemyController] Error spawning ragdoll:', error)
        }
    }

    _spawnRagdoll(position, velocity) {
        const scene = this.ctx?.viewer?.scene
        if (!scene) {
            console.warn('[BaseEnemyController] No scene found for ragdoll')
            return
        }

        if (!this.ctx?.ecp) {
            console.warn('[BaseEnemyController] ECP not available for ragdoll')
            return
        }

        // Create a temporary object for the ragdoll component
        const ragdollObj = new THREE.Group()
        ragdollObj.position.copy(position)
        scene.add(ragdollObj)

        // Add ragdoll component using ECP
        this.ctx.ecp.addComponent(ragdollObj, 'RagdollComponent')

        // Get the component
        const ragdoll = EntityComponentPlugin.GetComponent(ragdollObj, 'RagdollComponent')

        if (ragdoll) {
            console.log('[BaseEnemyController] Spawning ragdoll at', position)

            // Capture body states from animation for seamless transition
            const bodyStates = this._animComp ? this._animComp.getBodyStates() : null

            if (bodyStates) {
                console.log('[BaseEnemyController] Using animated body states for ragdoll')
            }

            // Spawn ragdoll with appropriate scale and color
            ragdoll.spawnRagdoll(position, velocity, {
                scale: this._getAnimationScale(),
                color: this._getAnimationColor(),
                enemyType: this.name,
                bodyStates: bodyStates
            })
        } else {
            console.warn('[BaseEnemyController] Failed to get RagdollComponent')
        }
    }

    _canAttack(now) {
        const cooldown = 1000 / this.attackFrequency
        return now - this._lastAttackTime >= cooldown
    }

    _attack(target) {
        const now = Date.now()
        if (!this._canAttack(now)) return false

        this._lastAttackTime = now

        // Try to damage the player
        const playerController = EntityComponentPlugin.GetComponent(target, 'PlayerController')
        if (playerController && typeof playerController.takeDamage === 'function') {
            playerController.takeDamage(this.damage, this)
        }

        return true
    }

    // ==================== PHYSICS ====================

    _applyPhysics(dt, inputX, inputZ) {
        if (!this._velocity) {
            this._velocity = new THREE.Vector3(0, 0, 0)
        }

        // Calculate acceleration based on input and mass
        const acceleration = this.speed * 2 / this.mass

        // Apply input force
        if (inputX !== 0 || inputZ !== 0) {
            this._velocity.x += inputX * acceleration * dt
            this._velocity.z += inputZ * acceleration * dt
        }

        // Apply friction
        const frictionFactor = Math.exp(-this.friction * dt)
        this._velocity.x *= frictionFactor
        this._velocity.z *= frictionFactor

        // Clamp to max speed
        const currentSpeed = Math.sqrt(this._velocity.x ** 2 + this._velocity.z ** 2)
        if (currentSpeed > this.speed) {
            const scale = this.speed / currentSpeed
            this._velocity.x *= scale
            this._velocity.z *= scale
        }

        // Apply velocity to position
        this.object.position.x += this._velocity.x * dt
        this.object.position.z += this._velocity.z * dt

        // Face movement direction (smooth rotation)
        if (currentSpeed > 0.1) {
            const targetRotation = Math.atan2(this._velocity.x, this._velocity.z)
            // Smooth rotation
            let rotDiff = targetRotation - this.object.rotation.y
            // Normalize angle
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
            this.object.rotation.y += rotDiff * Math.min(1, 10 * dt)
        }

        // Stop if very slow
        if (currentSpeed < 0.01) {
            this._velocity.x = 0
            this._velocity.z = 0
        }
    }

    // ==================== UPDATE LOOP ====================

    update({time, deltaTime}) {
        if (!this.object) return false

        const dt = deltaTime / 1000

        // Always update health bar
        this._updateHealthBar(deltaTime)

        if (!this.enabled || !this.isAlive) {
            // Still apply friction when disabled/dead
            this._applyPhysics(dt, 0, 0)
            return this._velocity && this._velocity.lengthSq() > 0.001
        }

        // Find player if not cached
        if (!this._player) {
            this._findPlayer()
            if (!this._player) {
                this._applyPhysics(dt, 0, 0)
                return false
            }
        }

        const myPos = this.object.position
        const playerPos = this._player.position
        const distToPlayer = Math.sqrt(
            Math.pow(playerPos.x - myPos.x, 2) +
            Math.pow(playerPos.z - myPos.z, 2)
        )

        // Check if player is within detection range
        if (distToPlayer > this.detectionRange) {
            this._applyPhysics(dt, 0, 0) // idle, just apply friction
            return this._velocity && this._velocity.lengthSq() > 0.001
        }

        // Within attack range - attack!
        if (distToPlayer <= this.attackRange) {
            this._attack(this._player)
            this._applyPhysics(dt, 0, 0) // stop moving when attacking
            return true
        }

        // Move towards player using A*
        const now = Date.now()
        if (now - this._lastPathUpdate > this._pathUpdateInterval || this._path.length === 0) {
            this._path = this._findPath(myPos.x, myPos.z, playerPos.x, playerPos.z)
            this._pathIndex = 0
            this._lastPathUpdate = now
        }

        // Follow path with physics
        let inputX = 0
        let inputZ = 0

        if (this._path.length > 0 && this._pathIndex < this._path.length) {
            const target = this._path[this._pathIndex]
            const dx = target.x - myPos.x
            const dz = target.z - myPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            if (dist < 0.3) {
                // Reached waypoint, move to next
                this._pathIndex++
            } else {
                // Calculate input direction
                inputX = dx / dist
                inputZ = dz / dist
            }
        }

        // Apply physics-based movement
        this._applyPhysics(dt, inputX, inputZ)

        return true
    }

    // UI Config
    ToggleEnabled = () => {
        this.enabled = !this.enabled
    }

    uiConfig = {
        type: 'folder',
        label: 'BaseEnemyController',
        children: [{
            type: 'button',
            label: 'Toggle Enabled',
            onClick: this.ToggleEnabled,
        }],
    }
}

