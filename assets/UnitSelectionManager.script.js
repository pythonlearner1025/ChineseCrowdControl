import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'

/**
 * UnitSelectionManager - Starcraft-style unit selection and control
 * - Box selection (click-drag)
 * - Control groups (Shift+N to assign, N to select)
 * - Right-click move commands with formation
 * Singleton component - should only have one in the scene
 */
export class UnitSelectionManager extends Object3DComponent {
    static StateProperties = ['enabled', 'formationRadius']
    static ComponentType = 'UnitSelectionManager'

    // Configuration
    enabled = true
    formationRadius = 1.5  // spacing between units in formation

    // Selection state
    _selectedUnits = []
    _controlGroups = {}  // { 1: [units], 2: [units], ... }

    // Box selection state
    _isSelecting = false
    _selectionStart = null
    _selectionBox = null

    // Event handlers
    _handleMouseDown = null
    _handleMouseMove = null
    _handleMouseUp = null
    _handleKeyDown = null
    _handleContextMenu = null

    // Raycaster for 3D picking
    _raycaster = null
    _mouse = null

    start() {
        if (super.start) super.start()

        // Initialize raycaster
        this._raycaster = new THREE.Raycaster()
        this._mouse = new THREE.Vector2()

        // Bind event handlers
        this._handleMouseDown = this._onMouseDown.bind(this)
        this._handleMouseMove = this._onMouseMove.bind(this)
        this._handleMouseUp = this._onMouseUp.bind(this)
        this._handleKeyDown = this._onKeyDown.bind(this)
        this._handleContextMenu = this._onContextMenu.bind(this)

        window.addEventListener('mousedown', this._handleMouseDown)
        window.addEventListener('mousemove', this._handleMouseMove)
        window.addEventListener('mouseup', this._handleMouseUp)
        window.addEventListener('keydown', this._handleKeyDown)
        window.addEventListener('contextmenu', this._handleContextMenu)

        //console.log('[UnitSelectionManager] Started - Drag to select, Shift+N for groups, right-click to move')
    }

    stop() {
        if (super.stop) super.stop()

        window.removeEventListener('mousedown', this._handleMouseDown)
        window.removeEventListener('mousemove', this._handleMouseMove)
        window.removeEventListener('mouseup', this._handleMouseUp)
        window.removeEventListener('keydown', this._handleKeyDown)
        window.removeEventListener('contextmenu', this._handleContextMenu)

        this._removeSelectionBox()
    }

    // ==================== MOUSE EVENTS ====================

    _onMouseDown(event) {
        if (!this.enabled) return
        if (event.button !== 0) return  // only left click

        // Start box selection
        this._isSelecting = true
        this._selectionStart = { x: event.clientX, y: event.clientY }
        this._createSelectionBox()
    }

    _onMouseMove(event) {
        if (!this._isSelecting) return

        // Update selection box
        this._updateSelectionBox(event.clientX, event.clientY)
    }

    _onMouseUp(event) {
        if (!this._isSelecting) return
        if (event.button !== 0) return

        this._isSelecting = false

        // Get all units in selection box
        const units = this._getUnitsInBox(
            this._selectionStart,
            { x: event.clientX, y: event.clientY }
        )

        // Select units (replace current selection unless shift is held)
        if (event.shiftKey) {
            this._addToSelection(units)
        } else {
            this.selectUnits(units)
        }

        this._removeSelectionBox()
    }

    _onContextMenu(event) {
        if (!this.enabled) return
        event.preventDefault()  // prevent context menu

        // Right-click: move selected units
        if (this._selectedUnits.length > 0) {
            const targetPos = this._raycastToGround(event)
            if (targetPos) {
                this._moveSelectedUnits(targetPos)
            }
        }
    }

    _onKeyDown(event) {
        if (!this.enabled) return

        const key = event.key
        const isShift = event.shiftKey

        // Shift + N: Assign to control group
        if (isShift && key >= '1' && key <= '9') {
            const groupId = parseInt(key)
            this._assignToGroup(groupId)
        }
        // N: Select control group
        else if (!isShift && key >= '1' && key <= '9') {
            const groupId = parseInt(key)
            this._selectGroup(groupId)
        }
    }

    // ==================== SELECTION BOX UI ====================

    _createSelectionBox() {
        this._removeSelectionBox()

        this._selectionBox = document.createElement('div')
        this._selectionBox.style.position = 'fixed'
        this._selectionBox.style.border = '2px solid #00ff00'
        this._selectionBox.style.backgroundColor = 'rgba(0, 255, 0, 0.1)'
        this._selectionBox.style.pointerEvents = 'none'
        this._selectionBox.style.zIndex = '9997'

        document.body.appendChild(this._selectionBox)
    }

    _updateSelectionBox(currentX, currentY) {
        if (!this._selectionBox || !this._selectionStart) return

        const left = Math.min(this._selectionStart.x, currentX)
        const top = Math.min(this._selectionStart.y, currentY)
        const width = Math.abs(currentX - this._selectionStart.x)
        const height = Math.abs(currentY - this._selectionStart.y)

        this._selectionBox.style.left = `${left}px`
        this._selectionBox.style.top = `${top}px`
        this._selectionBox.style.width = `${width}px`
        this._selectionBox.style.height = `${height}px`
    }

    _removeSelectionBox() {
        if (this._selectionBox) {
            document.body.removeChild(this._selectionBox)
            this._selectionBox = null
        }
    }

    // ==================== UNIT SELECTION ====================

    _getUnitsInBox(start, end) {
        const scene = this.ctx?.viewer?.scene
        const camera = this.ctx?.viewer?.scene?.mainCamera
        const container = this.ctx?.viewer?.container

        if (!scene || !camera || !container) return []

        // Get bounding box in screen space
        const minX = Math.min(start.x, end.x)
        const maxX = Math.max(start.x, end.x)
        const minY = Math.min(start.y, end.y)
        const maxY = Math.max(start.y, end.y)

        const rect = container.getBoundingClientRect()
        const units = []

        // Find all soldier controllers
        scene.traverse((obj) => {
            const soldier = EntityComponentPlugin.GetComponent(obj, 'RobotTireController')
            if (!soldier || !soldier.isAlive) return

            // Project unit position to screen space
            const worldPos = new THREE.Vector3()
            obj.getWorldPosition(worldPos)

            const screenPos = worldPos.clone().project(camera)

            // Convert from NDC (-1 to 1) to screen coordinates
            const screenX = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left
            const screenY = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top

            // Check if in selection box
            if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
                units.push(soldier)
            }
        })

        return units
    }

    selectUnits(units) {
        // Deselect all current units
        for (const unit of this._selectedUnits) {
            if (unit && unit.deselect) {
                unit.deselect()
            }
        }

        // Select new units
        this._selectedUnits = units.filter(u => u && u.isAlive)

        for (const unit of this._selectedUnits) {
            if (unit.select) {
                unit.select()
            }
        }

        //console.log(`[UnitSelectionManager] Selected ${this._selectedUnits.length} units`)
    }

    _addToSelection(units) {
        // Add units to current selection (avoid duplicates)
        for (const unit of units) {
            if (unit && unit.isAlive && !this._selectedUnits.includes(unit)) {
                this._selectedUnits.push(unit)
                if (unit.select) {
                    unit.select()
                }
            }
        }

        //console.log(`[UnitSelectionManager] Selection now has ${this._selectedUnits.length} units`)
    }

    deselectAll() {
        this.selectUnits([])
    }

    // ==================== CONTROL GROUPS ====================

    _assignToGroup(groupId) {
        if (this._selectedUnits.length === 0) {
            console.warn(`[UnitSelectionManager] No units selected to assign to group ${groupId}`)
            return
        }

        // Store current selection in control group
        this._controlGroups[groupId] = [...this._selectedUnits]

        // Update units' group ID
        for (const unit of this._selectedUnits) {
            if (unit.setGroup) {
                unit.setGroup(groupId)
            }
        }

        //console.log(`[UnitSelectionManager] Assigned ${this._selectedUnits.length} units to group ${groupId}`)

        // Visual feedback
        this._showGroupMessage(`Group ${groupId} Assigned`, 1000)
    }

    _selectGroup(groupId) {
        const group = this._controlGroups[groupId]

        if (!group || group.length === 0) {
            console.warn(`[UnitSelectionManager] No units in group ${groupId}`)
            return
        }

        // Filter out dead units
        const aliveUnits = group.filter(u => u && u.isAlive)

        if (aliveUnits.length === 0) {
            console.warn(`[UnitSelectionManager] All units in group ${groupId} are dead`)
            delete this._controlGroups[groupId]
            return
        }

        // Update group (remove dead units)
        this._controlGroups[groupId] = aliveUnits

        // Select the group
        this.selectUnits(aliveUnits)

        //console.log(`[UnitSelectionManager] Selected group ${groupId} (${aliveUnits.length} units)`)
    }

    _showGroupMessage(text, duration = 1000) {
        const messageDiv = document.createElement('div')
        messageDiv.style.position = 'fixed'
        messageDiv.style.top = '15%'
        messageDiv.style.left = '50%'
        messageDiv.style.transform = 'translate(-50%, -50%)'
        messageDiv.style.fontSize = '40px'
        messageDiv.style.fontWeight = 'bold'
        messageDiv.style.color = '#00ff00'
        messageDiv.style.textAlign = 'center'
        messageDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'
        messageDiv.style.padding = '15px 30px'
        messageDiv.style.borderRadius = '10px'
        messageDiv.style.zIndex = '9996'
        messageDiv.textContent = text

        document.body.appendChild(messageDiv)

        setTimeout(() => {
            document.body.removeChild(messageDiv)
        }, duration)
    }

    // ==================== UNIT MOVEMENT ====================

    _raycastToGround(event) {
        const camera = this.ctx?.viewer?.scene?.mainCamera
        const container = this.ctx?.viewer?.container

        if (!camera || !container) return null

        // Get mouse position in normalized device coordinates
        const rect = container.getBoundingClientRect()
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        // Raycast to ground plane (y = 0)
        this._raycaster.setFromCamera(this._mouse, camera)

        // Intersect with ground plane
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const targetPos = new THREE.Vector3()
        this._raycaster.ray.intersectPlane(groundPlane, targetPos)

        return targetPos
    }

    _moveSelectedUnits(targetPos) {
        const count = this._selectedUnits.length

        if (count === 0) return

        //console.log(`[UnitSelectionManager] Moving ${count} units to (${targetPos.x.toFixed(1)}, ${targetPos.z.toFixed(1)})`)

        if (count === 1) {
            // Single unit: move directly to target
            const unit = this._selectedUnits[0]
            if (unit.moveTo) {
                unit.moveTo(targetPos)
            }
        } else {
            // Multiple units: spread in circle formation
            const radius = Math.sqrt(count) * this.formationRadius

            for (let i = 0; i < count; i++) {
                const unit = this._selectedUnits[i]
                if (!unit || !unit.moveTo) continue

                // Calculate position in circle
                const angle = (Math.PI * 2 * i) / count
                const offset = new THREE.Vector3(
                    Math.cos(angle) * radius,
                    0,
                    Math.sin(angle) * radius
                )

                const unitTargetPos = targetPos.clone().add(offset)
                unit.moveTo(unitTargetPos)
            }
        }
    }

    // ==================== UPDATE ====================

    update({deltaTime}) {
        // Clean up dead units from selection
        const aliveBefore = this._selectedUnits.length
        this._selectedUnits = this._selectedUnits.filter(u => u && u.isAlive)

        if (this._selectedUnits.length < aliveBefore) {
            // Some units died, update selection visuals
            for (const unit of this._selectedUnits) {
                if (unit.select) {
                    unit.select()
                }
            }
        }

        return true
    }

    // ==================== UI CONFIG ====================

    TestSelectAll = () => {
        const scene = this.ctx?.viewer?.scene
        if (!scene) return

        const allSoldiers = []
        scene.traverse((obj) => {
            const soldier = EntityComponentPlugin.GetComponent(obj, 'RobotTireController')
            if (soldier && soldier.isAlive) {
                allSoldiers.push(soldier)
            }
        })

        this.selectUnits(allSoldiers)
    }

    TestDeselectAll = () => {
        this.deselectAll()
    }

    uiConfig = {
        type: 'folder',
        label: 'Unit Selection Manager',
        children: [
            {
                type: 'button',
                label: 'Select All Units',
                onClick: this.TestSelectAll,
            },
            {
                type: 'button',
                label: 'Deselect All',
                onClick: this.TestDeselectAll,
            },
        ],
    }
}
