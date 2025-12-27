import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * SoldierSelectionManager - Handles soldier selection, grouping, and movement commands
 * 
 * Controls:
 * - R: Select all soldiers within radius 10 of mouse position
 * - Cmd/Ctrl + Click: Add clicked soldier to selection
 * - Shift + 1-5: Assign selected soldiers to group 1-5
 * - 1-5: Select group 1-5
 * - Left Click: Move selected soldiers to clicked position
 */
export class SoldierSelectionManager extends Object3DComponent {
    static StateProperties = ['selectionRadius']
    static ComponentType = 'SoldierSelectionManager'

    selectionRadius = 10

    // State
    _soldiers = []
    _selectedSoldiers = new Set()
    _groups = {} // groupId -> Set of soldiers
    _activeGroup = null

    // Raycasting
    _raycaster = null
    _mouse = null
    _groundPlane = null

    // Drag tracking
    _isDragging = false

    start() {
        if (super.start) super.start()

        this._raycaster = new THREE.Raycaster()
        this._mouse = new THREE.Vector2()
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

        // Initialize groups 1-5
        for (let i = 1; i <= 5; i++) {
            this._groups[i] = new Set()
        }

        this._handleKeyDown = this._handleKeyDown.bind(this)
        this._handleMouseDown = this._handleMouseDown.bind(this)
        this._handleMouseMove = this._handleMouseMove.bind(this)
        this._handleMouseUp = this._handleMouseUp.bind(this)

        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('mousedown', this._handleMouseDown)
        window.addEventListener('mousemove', this._handleMouseMove)
        window.addEventListener('mouseup', this._handleMouseUp)

        // Find existing soldiers in scene
        this._findExistingSoldiers()
    }

    stop() {
        if (super.stop) super.stop()
        window.removeEventListener('keydown', this._handleKeyDown)
        window.removeEventListener('mousedown', this._handleMouseDown)
        window.removeEventListener('mousemove', this._handleMouseMove)
        window.removeEventListener('mouseup', this._handleMouseUp)
    }

    _findExistingSoldiers() {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        scene.traverse((obj) => {
            const soldier = EntityComponentPlugin.GetComponent(obj, 'SoldierController')
            if (soldier && !this._soldiers.includes(soldier)) {
                this._soldiers.push(soldier)
            }
        })
    }

    // ==================== SOLDIER REGISTRATION ====================

    registerSoldier(soldier) {
        if (!this._soldiers.includes(soldier)) {
            this._soldiers.push(soldier)
        }
    }

    unregisterSoldier(soldier) {
        const idx = this._soldiers.indexOf(soldier)
        if (idx !== -1) {
            this._soldiers.splice(idx, 1)
            this._selectedSoldiers.delete(soldier)
            // Remove from all groups
            for (const group of Object.values(this._groups)) {
                group.delete(soldier)
            }
        }
    }

    // ==================== MOUSE POSITION ====================

    _getMouseWorldPosition(event) {
        const viewer = this.ctx?.viewer
        if (!viewer) return null

        const camera = viewer.scene.mainCamera
        if (!camera) return null

        const rect = viewer.container.getBoundingClientRect()
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        this._raycaster.setFromCamera(this._mouse, camera)

        const intersection = new THREE.Vector3()
        if (this._raycaster.ray.intersectPlane(this._groundPlane, intersection)) {
            return intersection
        }

        return null
    }

    _getSoldierAtMouse(event) {
        const viewer = this.ctx?.viewer
        if (!viewer) return null

        const camera = viewer.scene.mainCamera
        if (!camera) return null

        const rect = viewer.container.getBoundingClientRect()
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        this._raycaster.setFromCamera(this._mouse, camera)

        // Check each soldier
        for (const soldier of this._soldiers) {
            if (!soldier.isAlive || !soldier.object) continue

            const soldierPos = soldier.object.position
            const ray = this._raycaster.ray

            // Simple distance from ray to soldier position
            const v = new THREE.Vector3().subVectors(soldierPos, ray.origin)
            const projection = v.dot(ray.direction)
            const closestPoint = ray.origin.clone().add(ray.direction.clone().multiplyScalar(projection))
            const dist = closestPoint.distanceTo(soldierPos)

            if (dist < 1.5) { // click radius
                return soldier
            }
        }

        return null
    }

    // ==================== SELECTION ====================

    selectSoldier(soldier, addToSelection = false) {
        if (!addToSelection) {
            this.clearSelection()
        }

        if (soldier.isAlive) {
            soldier.select()
            this._selectedSoldiers.add(soldier)
        }
    }

    deselectSoldier(soldier) {
        soldier.deselect()
        this._selectedSoldiers.delete(soldier)
    }

    clearSelection() {
        for (const soldier of this._selectedSoldiers) {
            soldier.deselect()
        }
        this._selectedSoldiers.clear()
        this._activeGroup = null
    }

    selectSoldiersInRadius(centerPos, radius) {
        this.clearSelection()

        for (const soldier of this._soldiers) {
            if (!soldier.isAlive || !soldier.object) continue

            const dist = soldier.object.position.distanceTo(centerPos)
            if (dist <= radius) {
                soldier.select()
                this._selectedSoldiers.add(soldier)
            }
        }
    }

    // ==================== GROUPING ====================

    assignSelectedToGroup(groupId) {
        if (this._selectedSoldiers.size === 0) {
            return
        }

        // Clear previous group assignment for these soldiers
        for (const soldier of this._selectedSoldiers) {
            for (const [gid, group] of Object.entries(this._groups)) {
                group.delete(soldier)
            }
        }

        // Assign to new group
        for (const soldier of this._selectedSoldiers) {
            this._groups[groupId].add(soldier)
            soldier.setGroup(groupId)
        }
    }

    selectGroup(groupId) {
        const group = this._groups[groupId]
        if (!group || group.size === 0) {
            return
        }

        this.clearSelection()

        for (const soldier of group) {
            if (soldier.isAlive) {
                soldier.select()
                this._selectedSoldiers.add(soldier)
            }
        }

        this._activeGroup = groupId
    }

    // ==================== MOVEMENT COMMANDS ====================

    moveSelectedTo(position) {
        if (this._selectedSoldiers.size === 0) return

        // Calculate formation positions (simple grid)
        const soldiers = Array.from(this._selectedSoldiers)
        const count = soldiers.length
        const spacing = 1.5
        const cols = Math.ceil(Math.sqrt(count))

        for (let i = 0; i < soldiers.length; i++) {
            const soldier = soldiers[i]
            if (!soldier.isAlive) continue

            const row = Math.floor(i / cols)
            const col = i % cols

            // Offset from center
            const offsetX = (col - (cols - 1) / 2) * spacing
            const offsetZ = row * spacing

            const targetPos = new THREE.Vector3(
                position.x + offsetX,
                position.y,
                position.z + offsetZ
            )

            soldier.moveTo(targetPos)
        }
    }

    // ==================== INPUT HANDLERS ====================

    _handleKeyDown(event) {
        const key = event.key.toLowerCase()

        // R - Select soldiers in radius around mouse (need stored mouse pos)
        if (key === 'r') {
            // We need to select around player or last known position
            // For now, use center of selected soldiers or player position
            const centerPos = this._getSelectionCenter()
            if (centerPos) {
                this.selectSoldiersInRadius(centerPos, this.selectionRadius)
            }
            return
        }

        // Shift + 1-5 - Assign to group
        if (event.shiftKey && ['1', '2', '3', '4', '5'].includes(event.key)) {
            const groupId = parseInt(event.key)
            this.assignSelectedToGroup(groupId)
            event.preventDefault()
            return
        }

        // 1-5 without shift - Select group
        if (!event.shiftKey && !event.metaKey && !event.ctrlKey && ['1', '2', '3', '4', '5'].includes(event.key)) {
            const groupId = parseInt(event.key)
            this.selectGroup(groupId)
            return
        }

        // Escape - Clear selection
        if (key === 'escape') {
            this.clearSelection()
            return
        }
    }

    _handleMouseDown(event) {
        // Only handle left click
        if (event.button !== 0) return

        const isModifierClick = event.metaKey || event.ctrlKey

        // Check if clicking on a soldier FIRST (before checking modifiers)
        const clickedSoldier = this._getSoldierAtMouse(event)

        // Cmd/Ctrl + Click on soldier - Add/remove from selection
        if (isModifierClick && clickedSoldier) {
            if (this._selectedSoldiers.has(clickedSoldier)) {
                this.deselectSoldier(clickedSoldier)
            } else {
                this.selectSoldier(clickedSoldier, true) // add to selection
            }
            return
        }

        // Simple click on soldier - Select it (clear previous selection)
        if (clickedSoldier) {
            console.log('[SoldierSelectionManager] Soldier clicked - selecting:', clickedSoldier)
            this.selectSoldier(clickedSoldier, false) // Replace selection
            return
        }

        // Clicking on ground - Move selected soldiers
        if (this._selectedSoldiers.size > 0) {
            this._isDragging = true
            const worldPos = this._getMouseWorldPosition(event)
            if (worldPos) {
                console.log('[SoldierSelectionManager] Moving', this._selectedSoldiers.size, 'soldiers to', worldPos)
                this.moveSelectedTo(worldPos)
            }
        } else {
            // No soldiers selected and clicking empty ground - just clear selection
            this.clearSelection()
        }
    }

    _handleMouseMove(event) {
        // Only track if dragging with soldiers selected
        if (!this._isDragging || this._selectedSoldiers.size === 0) return

        const worldPos = this._getMouseWorldPosition(event)
        if (worldPos) {
            this.moveSelectedTo(worldPos)
        }
    }

    _handleMouseUp(event) {
        if (event.button === 0) {
            this._isDragging = false
        }
    }

    _getSelectionCenter() {
        // If we have selected soldiers, use their center
        if (this._selectedSoldiers.size > 0) {
            const center = new THREE.Vector3()
            let count = 0
            for (const soldier of this._selectedSoldiers) {
                if (soldier.object) {
                    center.add(soldier.object.position)
                    count++
                }
            }
            if (count > 0) {
                center.divideScalar(count)
                return center
            }
        }

        // Otherwise try to find player position
        const scene = this.ctx?.viewer?.scene
        if (scene) {
            let playerPos = null
            scene.traverse((obj) => {
                if (playerPos) return
                const player = EntityComponentPlugin.GetComponent(obj, 'PlayerController')
                if (player && player.object) {
                    playerPos = player.object.position.clone()
                }
            })
            if (playerPos) return playerPos
        }

        // Fallback to origin
        return new THREE.Vector3(0, 0, 0)
    }

    update({deltaTime}) {
        // Cleanup dead soldiers from selection and groups
        for (const soldier of [...this._selectedSoldiers]) {
            if (!soldier.isAlive) {
                this._selectedSoldiers.delete(soldier)
            }
        }

        for (const group of Object.values(this._groups)) {
            for (const soldier of [...group]) {
                if (!soldier.isAlive) {
                    group.delete(soldier)
                }
            }
        }

        return false
    }

    uiConfig = {
        type: 'folder',
        label: 'SoldierSelectionManager',
        children: [
            {
                type: 'button',
                label: 'Clear Selection',
                onClick: () => this.clearSelection(),
            },
            {
                type: 'button',
                label: 'Select All',
                onClick: () => {
                    this.clearSelection()
                    for (const soldier of this._soldiers) {
                        if (soldier.isAlive) {
                            this.selectSoldier(soldier, true)
                        }
                    }
                },
            },
        ],
    }
}

