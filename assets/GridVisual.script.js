import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'

/**
 * GridVisual - Renders a visual grid overlay on the ground plane
 *
 * Attach to any object to display a grid. The grid will be drawn
 * at the object's Y position, extending in the XZ plane.
 *
 * Can also highlight specific cells (used by BuildingPlacer)
 */
export class GridVisual extends Object3DComponent {
    static StateProperties = [
        'gridSize', 'gridExtent', 'lineColor', 'lineOpacity',
        'showGrid', 'fadeDistance'
    ]
    static ComponentType = 'GridVisual'

    // Grid settings
    gridSize = 1          // Size of each grid cell (1 unit = 1 meter)
    gridExtent = 30       // How far the grid extends in each direction
    lineColor = 0x444444  // Grid line color
    lineOpacity = 0.4     // Grid line opacity
    showGrid = true       // Whether to show the grid
    fadeDistance = 20     // Distance at which grid starts to fade

    // Internal
    _gridHelper = null
    _highlightMesh = null
    _highlightMaterial = null

    constructor() {
        super()
        this.onStateChange('showGrid', (v) => {
            if (this._gridHelper) this._gridHelper.visible = v
        })
        this.onStateChange('gridSize', () => this._recreateGrid())
        this.onStateChange('gridExtent', () => this._recreateGrid())
        this.onStateChange('lineColor', () => this._recreateGrid())
    }

    start() {
        if (super.start) super.start()
        this._createGrid()
        this._createHighlight()
    }

    stop() {
        if (super.stop) super.stop()
        this._removeGrid()
        this._removeHighlight()
    }

    // ==================== GRID ====================

    _createGrid() {
        this._removeGrid()

        if (!this.object) return

        const divisions = Math.floor(this.gridExtent * 2 / this.gridSize)
        const size = this.gridExtent * 2

        // Create custom grid with better visual control
        this._gridHelper = new THREE.Group()
        this._gridHelper.name = 'GridVisualHelper'

        const material = new THREE.LineBasicMaterial({
            color: this.lineColor,
            transparent: true,
            opacity: this.lineOpacity,
            depthWrite: false
        })

        const halfExtent = this.gridExtent

        // Create grid lines
        const points = []

        // Lines along X axis (running in Z direction)
        for (let i = -halfExtent; i <= halfExtent; i += this.gridSize) {
            points.push(new THREE.Vector3(i, 0.01, -halfExtent))
            points.push(new THREE.Vector3(i, 0.01, halfExtent))
        }

        // Lines along Z axis (running in X direction)
        for (let i = -halfExtent; i <= halfExtent; i += this.gridSize) {
            points.push(new THREE.Vector3(-halfExtent, 0.01, i))
            points.push(new THREE.Vector3(halfExtent, 0.01, i))
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points)
        const lines = new THREE.LineSegments(geometry, material)
        lines.renderOrder = -1

        this._gridHelper.add(lines)
        this._gridHelper.visible = this.showGrid

        // Position at object's Y level
        const worldPos = new THREE.Vector3()
        this.object.getWorldPosition(worldPos)
        this._gridHelper.position.y = worldPos.y

        this.ctx?.viewer?.scene?.add(this._gridHelper)
    }

    _removeGrid() {
        if (this._gridHelper) {
            this._gridHelper.traverse((child) => {
                if (child.geometry) child.geometry.dispose()
                if (child.material) child.material.dispose()
            })
            this._gridHelper.removeFromParent()
            this._gridHelper = null
        }
    }

    _recreateGrid() {
        if (this.ctx?.ecp?.running) {
            this._createGrid()
        }
    }

    // ==================== CELL HIGHLIGHT ====================

    _createHighlight() {
        this._removeHighlight()

        // Create a highlight mesh for showing selected grid cell
        const geometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize)
        this._highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0x44ff44,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false
        })

        this._highlightMesh = new THREE.Mesh(geometry, this._highlightMaterial)
        this._highlightMesh.rotation.x = -Math.PI / 2
        this._highlightMesh.position.y = 0.02
        this._highlightMesh.visible = false
        this._highlightMesh.renderOrder = 0
        this._highlightMesh.name = 'GridCellHighlight'

        this.ctx?.viewer?.scene?.add(this._highlightMesh)
    }

    _removeHighlight() {
        if (this._highlightMesh) {
            this._highlightMesh.geometry?.dispose()
            this._highlightMaterial?.dispose()
            this._highlightMesh.removeFromParent()
            this._highlightMesh = null
            this._highlightMaterial = null
        }
    }

    /**
     * Show highlight at a specific grid cell
     * @param {number} x - World X position (will be snapped to grid)
     * @param {number} z - World Z position (will be snapped to grid)
     * @param {number} width - Width of highlight in grid cells
     * @param {number} depth - Depth of highlight in grid cells
     * @param {boolean} valid - Whether placement is valid (affects color)
     */
    showHighlight(x, z, width = 1, depth = 1, valid = true) {
        if (!this._highlightMesh) return

        // Snap to grid
        const snappedX = this.snapToGrid(x)
        const snappedZ = this.snapToGrid(z)

        // Update position
        this._highlightMesh.position.x = snappedX
        this._highlightMesh.position.z = snappedZ

        // Update size if needed
        const newWidth = width * this.gridSize
        const newDepth = depth * this.gridSize
        const currentGeo = this._highlightMesh.geometry
        if (currentGeo.parameters.width !== newWidth || currentGeo.parameters.height !== newDepth) {
            this._highlightMesh.geometry.dispose()
            this._highlightMesh.geometry = new THREE.PlaneGeometry(newWidth, newDepth)
        }

        // Update color
        this._highlightMaterial.color.setHex(valid ? 0x44ff44 : 0xff4444)
        this._highlightMaterial.opacity = valid ? 0.3 : 0.25

        this._highlightMesh.visible = true
    }

    /**
     * Hide the cell highlight
     */
    hideHighlight() {
        if (this._highlightMesh) {
            this._highlightMesh.visible = false
        }
    }

    /**
     * Snap a world coordinate to the nearest grid cell center
     * @param {number} value - World coordinate
     * @returns {number} - Snapped coordinate
     */
    snapToGrid(value) {
        return Math.round(value / this.gridSize) * this.gridSize
    }

    /**
     * Get the grid cell coordinates for a world position
     * @param {number} x - World X
     * @param {number} z - World Z
     * @returns {{cellX: number, cellZ: number, worldX: number, worldZ: number}}
     */
    getGridCell(x, z) {
        const cellX = Math.round(x / this.gridSize)
        const cellZ = Math.round(z / this.gridSize)
        return {
            cellX,
            cellZ,
            worldX: cellX * this.gridSize,
            worldZ: cellZ * this.gridSize
        }
    }

    // ==================== UI CONFIG ====================

    ToggleGrid = () => {
        this.showGrid = !this.showGrid
    }

    uiConfig = {
        type: 'folder',
        label: 'Grid Visual',
        children: [
            {
                type: 'button',
                label: 'Toggle Grid',
                onClick: this.ToggleGrid,
            },
        ],
    }
}

// Export helper to find GridVisual in scene
export function getGridVisual(ctx) {
    return ctx?.ecp?.getComponentOfType?.('GridVisual')
}
