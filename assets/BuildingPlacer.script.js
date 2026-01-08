import {Object3DComponent, EntityComponentPlugin} from 'threepipe'
import * as THREE from 'three'
import {getGridVisual} from './GridVisual.script.js'

/**
 * BuildingPlacer - UI toolbar and placement system for buildings
 *
 * Features:
 * - Bottom-center toolbar with building type buttons
 * - Ghost mesh preview at mouse position with GRID SNAPPING
 * - Day-only placement validation
 * - Money cost checking
 * - Keyboard shortcuts (1=Barricade, 2=Road, Escape=cancel)
 * - R to rotate building 90 degrees
 */
export class BuildingPlacer extends Object3DComponent {
    static StateProperties = ['enabled', 'gridSize', 'snapToGrid']
    static ComponentType = 'BuildingPlacer'

    enabled = true
    gridSize = 1        // Grid cell size (1 unit = 1 meter)
    snapToGrid = true   // Whether to snap placement to grid

    // Building definitions with grid dimensions
    _buildings = {
        barricade: {
            name: 'Barricade',
            cost: 100,
            componentType: 'Barricade',
            ghostGeometry: () => new THREE.BoxGeometry(1, 2, 0.3),
            ghostOffset: new THREE.Vector3(0, 1, 0),
            color: 0x808080,
            gridWidth: 1,   // Width in grid cells
            gridDepth: 1    // Depth in grid cells
        },
        road: {
            name: 'Road',
            cost: 50,
            componentType: 'Road',
            ghostGeometry: () => {
                const geo = new THREE.PlaneGeometry(2, 2)
                geo.rotateX(-Math.PI / 2)
                return geo
            },
            ghostOffset: new THREE.Vector3(0, 0.02, 0),
            color: 0x1a1a1a,
            gridWidth: 2,
            gridDepth: 2
        }
    }

    // State
    _selectedType = null
    _isPlacementValid = false
    _rotation = 0  // Current rotation in radians (0, PI/2, PI, 3PI/2)

    // Snapped position
    _snappedX = 0
    _snappedZ = 0

    // UI elements
    _toolbarElement = null

    // Ghost preview
    _ghostMesh = null
    _ghostMaterial = null
    _ghostGroup = null

    // Grid cell outline
    _gridOutline = null
    _gridOutlineMaterial = null

    // Raycasting
    _raycaster = new THREE.Raycaster()
    _mouse = new THREE.Vector2()
    _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    _intersectionPoint = new THREE.Vector3()

    // Event handlers
    _handleMouseMove = null
    _handleMouseDown = null
    _handleKeyDown = null

    // References
    _moneyCounter = null
    _dayNightManager = null
    _gridVisual = null

    start() {
        if (super.start) super.start()

        // Cache references
        this._moneyCounter = this.ctx?.ecp?.getComponentOfType?.('MoneyCounter')
        this._dayNightManager = this.ctx?.ecp?.getComponentOfType?.('DayNightManager')
        this._gridVisual = getGridVisual(this.ctx)

        // Create UI
        this._createToolbar()

        // Setup event listeners
        this._handleMouseMove = this._onMouseMove.bind(this)
        this._handleMouseDown = this._onMouseDown.bind(this)
        this._handleKeyDown = this._onKeyDown.bind(this)

        window.addEventListener('mousemove', this._handleMouseMove)
        window.addEventListener('mousedown', this._handleMouseDown)
        window.addEventListener('keydown', this._handleKeyDown)
    }

    stop() {
        if (super.stop) super.stop()

        this._removeToolbar()
        this._removeGhost()
        this._removeGridOutline()

        // Hide grid highlight
        if (this._gridVisual) {
            this._gridVisual.hideHighlight()
        }

        window.removeEventListener('mousemove', this._handleMouseMove)
        window.removeEventListener('mousedown', this._handleMouseDown)
        window.removeEventListener('keydown', this._handleKeyDown)
    }

    // ==================== GRID SNAPPING ====================

    _snapToGrid(value) {
        if (!this.snapToGrid) return value
        return Math.round(value / this.gridSize) * this.gridSize
    }

    _getSnappedPosition(x, z) {
        return {
            x: this._snapToGrid(x),
            z: this._snapToGrid(z)
        }
    }

    // ==================== TOOLBAR UI ====================

    _createToolbar() {
        this._removeToolbar()

        this._toolbarElement = document.createElement('div')
        this._toolbarElement.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            display: flex;
            gap: 10px;
            padding: 12px 20px;
            background: linear-gradient(180deg, rgba(30,30,40,0.95) 0%, rgba(20,20,30,0.98) 100%);
            border-radius: 12px;
            border: 2px solid rgba(255,255,255,0.1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: 'Segoe UI', Arial, sans-serif;
        `

        // Create building buttons
        for (const [key, building] of Object.entries(this._buildings)) {
            const button = this._createBuildingButton(key, building)
            this._toolbarElement.appendChild(button)
        }

        // Rotate button
        const rotateBtn = document.createElement('button')
        rotateBtn.style.cssText = `
            padding: 10px 16px;
            background: rgba(80,80,120,0.3);
            border: 2px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            color: #aaa;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        `
        rotateBtn.innerHTML = '↻ Rotate<br><span style="font-size:11px;color:#666">[R]</span>'
        rotateBtn.onmouseenter = () => {
            rotateBtn.style.background = 'rgba(100,100,150,0.4)'
            rotateBtn.style.borderColor = '#8888ff'
        }
        rotateBtn.onmouseleave = () => {
            rotateBtn.style.background = 'rgba(80,80,120,0.3)'
            rotateBtn.style.borderColor = 'rgba(255,255,255,0.2)'
        }
        rotateBtn.onclick = () => this._rotateBuilding()
        this._toolbarElement.appendChild(rotateBtn)

        // Cancel button
        const cancelBtn = document.createElement('button')
        cancelBtn.style.cssText = `
            padding: 10px 16px;
            background: rgba(100,100,100,0.3);
            border: 2px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            color: #aaa;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        `
        cancelBtn.innerHTML = 'Cancel<br><span style="font-size:11px;color:#666">[Esc]</span>'
        cancelBtn.onmouseenter = () => {
            cancelBtn.style.background = 'rgba(150,100,100,0.4)'
            cancelBtn.style.borderColor = '#ff6666'
        }
        cancelBtn.onmouseleave = () => {
            cancelBtn.style.background = 'rgba(100,100,100,0.3)'
            cancelBtn.style.borderColor = 'rgba(255,255,255,0.2)'
        }
        cancelBtn.onclick = () => this._cancelPlacement()
        this._toolbarElement.appendChild(cancelBtn)

        const container = this.ctx?.viewer?.container || document.body
        container.appendChild(this._toolbarElement)
    }

    _createBuildingButton(key, building) {
        const button = document.createElement('button')
        button.dataset.buildingType = key
        button.style.cssText = `
            padding: 12px 20px;
            background: rgba(60,60,80,0.5);
            border: 2px solid rgba(255,255,255,0.15);
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            min-width: 100px;
        `

        const nameSpan = document.createElement('span')
        nameSpan.textContent = building.name
        nameSpan.style.fontSize = '15px'

        const costSpan = document.createElement('span')
        costSpan.textContent = `$${building.cost}`
        costSpan.style.cssText = `
            color: #FFD166;
            font-size: 13px;
        `

        const keySpan = document.createElement('span')
        const keyNum = Object.keys(this._buildings).indexOf(key) + 1
        keySpan.textContent = `[${keyNum}]`
        keySpan.style.cssText = `
            color: #888;
            font-size: 11px;
        `

        button.appendChild(nameSpan)
        button.appendChild(costSpan)
        button.appendChild(keySpan)

        button.onmouseenter = () => {
            if (this._selectedType !== key) {
                button.style.background = 'rgba(80,80,120,0.6)'
                button.style.borderColor = 'rgba(255,255,255,0.3)'
            }
        }
        button.onmouseleave = () => {
            if (this._selectedType !== key) {
                button.style.background = 'rgba(60,60,80,0.5)'
                button.style.borderColor = 'rgba(255,255,255,0.15)'
            }
        }
        button.onclick = () => this._selectBuilding(key)

        return button
    }

    _updateButtonStates() {
        if (!this._toolbarElement) return

        const buttons = this._toolbarElement.querySelectorAll('button[data-building-type]')
        buttons.forEach((btn) => {
            const type = btn.dataset.buildingType
            if (type === this._selectedType) {
                btn.style.background = 'rgba(46, 196, 182, 0.4)'
                btn.style.borderColor = '#2EC4B6'
                btn.style.boxShadow = '0 0 12px rgba(46, 196, 182, 0.3)'
            } else {
                btn.style.background = 'rgba(60,60,80,0.5)'
                btn.style.borderColor = 'rgba(255,255,255,0.15)'
                btn.style.boxShadow = 'none'
            }
        })
    }

    _removeToolbar() {
        if (this._toolbarElement) {
            this._toolbarElement.remove()
            this._toolbarElement = null
        }
    }

    // ==================== BUILDING SELECTION ====================

    _selectBuilding(type) {
        if (this._selectedType === type) {
            // Deselect if clicking same type
            this._cancelPlacement()
            return
        }

        this._selectedType = type
        this._rotation = 0  // Reset rotation on new selection
        this._updateButtonStates()
        this._createGhost(type)
        this._createGridOutline(type)
    }

    _cancelPlacement() {
        this._selectedType = null
        this._rotation = 0
        this._updateButtonStates()
        this._removeGhost()
        this._removeGridOutline()

        // Hide grid highlight
        if (this._gridVisual) {
            this._gridVisual.hideHighlight()
        }
    }

    _rotateBuilding() {
        this._rotation = (this._rotation + Math.PI / 2) % (Math.PI * 2)
        if (this._ghostGroup) {
            this._ghostGroup.rotation.y = this._rotation
        }
        // Update grid outline for rotated building
        if (this._selectedType) {
            this._updateGridOutline()
        }
    }

    // ==================== GHOST PREVIEW ====================

    _createGhost(type) {
        this._removeGhost()

        const building = this._buildings[type]
        if (!building) return

        const geometry = building.ghostGeometry()
        this._ghostMaterial = new THREE.MeshBasicMaterial({
            color: building.color,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthWrite: false
        })

        this._ghostMesh = new THREE.Mesh(geometry, this._ghostMaterial)
        this._ghostMesh.name = 'BuildingGhost'
        this._ghostMesh.renderOrder = 999

        // Apply offset
        this._ghostMesh.position.copy(building.ghostOffset)

        // Create a group to handle positioning and rotation
        const ghostGroup = new THREE.Group()
        ghostGroup.name = 'BuildingGhostGroup'
        ghostGroup.add(this._ghostMesh)

        this.ctx?.viewer?.scene?.add(ghostGroup)
        this._ghostGroup = ghostGroup
    }

    _removeGhost() {
        if (this._ghostGroup) {
            this._ghostGroup.removeFromParent()
            this._ghostMesh?.geometry?.dispose()
            this._ghostMaterial?.dispose()
            this._ghostGroup = null
            this._ghostMesh = null
            this._ghostMaterial = null
        }
    }

    _updateGhostPosition(x, z) {
        if (!this._ghostGroup) return

        // Store snapped position
        this._snappedX = x
        this._snappedZ = z

        this._ghostGroup.position.set(x, 0, z)
        this._ghostGroup.rotation.y = this._rotation
    }

    _updateGhostColor(isValid) {
        if (!this._ghostMaterial) return

        if (isValid) {
            this._ghostMaterial.color.setHex(0x44ff44)  // Green
            this._ghostMaterial.opacity = 0.7
        } else {
            this._ghostMaterial.color.setHex(0xff4444)  // Red
            this._ghostMaterial.opacity = 0.5
        }
    }

    // ==================== GRID OUTLINE ====================

    _createGridOutline(type) {
        this._removeGridOutline()

        const building = this._buildings[type]
        if (!building) return

        // Get dimensions accounting for rotation
        const width = building.gridWidth * this.gridSize
        const depth = building.gridDepth * this.gridSize

        // Create outline geometry
        const points = [
            new THREE.Vector3(-width / 2, 0.03, -depth / 2),
            new THREE.Vector3(width / 2, 0.03, -depth / 2),
            new THREE.Vector3(width / 2, 0.03, depth / 2),
            new THREE.Vector3(-width / 2, 0.03, depth / 2),
            new THREE.Vector3(-width / 2, 0.03, -depth / 2)
        ]

        const geometry = new THREE.BufferGeometry().setFromPoints(points)
        this._gridOutlineMaterial = new THREE.LineBasicMaterial({
            color: 0x44ff44,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        })

        this._gridOutline = new THREE.Line(geometry, this._gridOutlineMaterial)
        this._gridOutline.name = 'BuildingGridOutline'
        this._gridOutline.renderOrder = 1000

        this.ctx?.viewer?.scene?.add(this._gridOutline)
    }

    _removeGridOutline() {
        if (this._gridOutline) {
            this._gridOutline.geometry?.dispose()
            this._gridOutlineMaterial?.dispose()
            this._gridOutline.removeFromParent()
            this._gridOutline = null
            this._gridOutlineMaterial = null
        }
    }

    _updateGridOutline() {
        if (!this._gridOutline || !this._selectedType) return

        const building = this._buildings[this._selectedType]
        if (!building) return

        // Get dimensions - swap if rotated 90 or 270 degrees
        let width = building.gridWidth * this.gridSize
        let depth = building.gridDepth * this.gridSize

        // Check if rotated by 90 or 270 degrees
        const rotationDeg = (this._rotation * 180 / Math.PI) % 360
        if (Math.abs(rotationDeg - 90) < 1 || Math.abs(rotationDeg - 270) < 1) {
            [width, depth] = [depth, width]
        }

        // Update position
        this._gridOutline.position.set(this._snappedX, 0, this._snappedZ)

        // Recreate geometry with new dimensions
        const points = [
            new THREE.Vector3(-width / 2, 0.03, -depth / 2),
            new THREE.Vector3(width / 2, 0.03, -depth / 2),
            new THREE.Vector3(width / 2, 0.03, depth / 2),
            new THREE.Vector3(-width / 2, 0.03, depth / 2),
            new THREE.Vector3(-width / 2, 0.03, -depth / 2)
        ]

        this._gridOutline.geometry.dispose()
        this._gridOutline.geometry = new THREE.BufferGeometry().setFromPoints(points)

        // Update color based on validity
        this._gridOutlineMaterial.color.setHex(this._isPlacementValid ? 0x44ff44 : 0xff4444)
    }

    // ==================== VALIDATION ====================

    _checkPlacementValid() {
        if (!this._selectedType) return false

        const building = this._buildings[this._selectedType]
        if (!building) return false

        // Check if day phase
        if (this._dayNightManager && !this._dayNightManager.isDay) {
            return false
        }

        // Check if can afford
        if (this._moneyCounter && !this._moneyCounter.canAfford(building.cost)) {
            return false
        }

        return true
    }

    // ==================== PLACEMENT ====================

    _placeBuilding() {
        if (!this._selectedType || !this._ghostGroup) return
        if (!this._isPlacementValid) {
            this._showInvalidFeedback()
            return
        }

        const building = this._buildings[this._selectedType]
        if (!building) return

        // Spend money
        if (this._moneyCounter) {
            if (!this._moneyCounter.spendMoney(building.cost)) {
                this._showInvalidFeedback()
                return
            }
        }

        // Create building object at snapped position
        const buildingObj = new THREE.Group()
        buildingObj.name = `${building.name}_${Date.now()}`
        buildingObj.position.set(this._snappedX, 0, this._snappedZ)
        buildingObj.rotation.y = this._rotation

        // Add to scene
        const modelRoot = this.ctx?.viewer?.scene?.modelRoot
        if (modelRoot) {
            modelRoot.add(buildingObj)
        } else {
            this.ctx?.viewer?.scene?.add(buildingObj)
        }

        // Add component
        const action = this.ctx?.ecp?.addComponent(buildingObj, building.componentType)
        if (action && action.component) {
            console.log(`[BuildingPlacer] Placed ${building.name} at grid (${this._snappedX}, ${this._snappedZ})`)
        }

        // Show placement feedback
        this._showPlacementFeedback(buildingObj.position)

        // Keep selected for rapid placement (don't cancel)
    }

    _showInvalidFeedback() {
        // Flash the ghost red
        if (this._ghostMaterial) {
            this._ghostMaterial.color.setHex(0xff0000)
            this._ghostMaterial.opacity = 0.9

            setTimeout(() => {
                if (this._ghostMaterial) {
                    this._updateGhostColor(this._isPlacementValid)
                }
            }, 150)
        }

        // Flash grid outline
        if (this._gridOutlineMaterial) {
            this._gridOutlineMaterial.color.setHex(0xff0000)
            setTimeout(() => {
                if (this._gridOutlineMaterial) {
                    this._gridOutlineMaterial.color.setHex(this._isPlacementValid ? 0x44ff44 : 0xff4444)
                }
            }, 150)
        }

        // Flash money counter if exists
        if (this._moneyCounter && this._moneyCounter._flashUI) {
            this._moneyCounter._flashUI('#ff4444')
        }
    }

    _showPlacementFeedback(position) {
        // Create a brief flash effect at placement location
        const building = this._buildings[this._selectedType]
        const width = building ? building.gridWidth * this.gridSize : 1
        const depth = building ? building.gridDepth * this.gridSize : 1

        const flashGeometry = new THREE.PlaneGeometry(width + 0.2, depth + 0.2)
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            depthWrite: false
        })
        const flash = new THREE.Mesh(flashGeometry, flashMaterial)
        flash.rotation.x = -Math.PI / 2
        flash.position.copy(position)
        flash.position.y = 0.05

        this.ctx?.viewer?.scene?.add(flash)

        // Animate and remove
        let scale = 1
        const animate = () => {
            scale += 0.08
            flash.scale.set(scale, scale, scale)
            flashMaterial.opacity -= 0.06

            if (flashMaterial.opacity > 0) {
                requestAnimationFrame(animate)
            } else {
                flash.removeFromParent()
                flashGeometry.dispose()
                flashMaterial.dispose()
            }
        }
        requestAnimationFrame(animate)
    }

    // ==================== INPUT HANDLERS ====================

    _onMouseMove(event) {
        if (!this._selectedType || !this._ghostGroup) return

        // Get mouse position in normalized device coordinates
        const canvas = this.ctx?.viewer?.canvas
        if (!canvas) return

        const rect = canvas.getBoundingClientRect()
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

        // Raycast to ground plane
        const camera = this.ctx?.viewer?.scene?.mainCamera
        if (!camera) return

        this._raycaster.setFromCamera(this._mouse, camera)
        const intersects = this._raycaster.ray.intersectPlane(this._groundPlane, this._intersectionPoint)

        if (intersects) {
            // Snap to grid
            const snapped = this._getSnappedPosition(this._intersectionPoint.x, this._intersectionPoint.z)
            this._updateGhostPosition(snapped.x, snapped.z)

            // Update grid outline position
            if (this._gridOutline) {
                this._gridOutline.position.set(snapped.x, 0, snapped.z)
            }

            // Update GridVisual highlight if available
            if (this._gridVisual && this._selectedType) {
                const building = this._buildings[this._selectedType]
                this._gridVisual.showHighlight(
                    snapped.x, snapped.z,
                    building.gridWidth, building.gridDepth,
                    this._isPlacementValid
                )
            }
        }

        // Update validity
        this._isPlacementValid = this._checkPlacementValid()
        this._updateGhostColor(this._isPlacementValid)
        this._updateGridOutline()
    }

    _onMouseDown(event) {
        if (event.button !== 0) return  // Left click only
        if (!this._selectedType) return

        // Check if clicking on UI
        if (event.target !== this.ctx?.viewer?.canvas) return

        this._placeBuilding()
    }

    _onKeyDown(event) {
        // Number keys to select buildings
        const buildingKeys = Object.keys(this._buildings)
        const keyIndex = parseInt(event.key) - 1

        if (keyIndex >= 0 && keyIndex < buildingKeys.length) {
            this._selectBuilding(buildingKeys[keyIndex])
            return
        }

        // R to rotate
        if (event.key === 'r' || event.key === 'R') {
            if (this._selectedType) {
                this._rotateBuilding()
            }
            return
        }

        // Escape to cancel
        if (event.key === 'Escape') {
            this._cancelPlacement()
        }
    }

    // ==================== UPDATE ====================

    preFrame() {
        // Update ghost visibility based on day/night
        if (this._ghostGroup && this._dayNightManager) {
            // Refresh validity check
            this._isPlacementValid = this._checkPlacementValid()
            this._updateGhostColor(this._isPlacementValid)
        }
    }
}
