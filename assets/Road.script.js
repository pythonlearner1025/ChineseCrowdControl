import {Object3DComponent} from 'threepipe'
import * as THREE from 'three'

/**
 * Road - Cosmetic asphalt road with lane markings
 *
 * Specifications:
 * - Purely cosmetic (no gameplay effect)
 * - Dark asphalt with white lane markings
 * - Cost: $50 (handled by BuildingPlacer)
 * - No HP, no physics
 */
export class Road extends Object3DComponent {
    static StateProperties = ['roadWidth', 'roadLength']
    static ComponentType = 'Road'

    // Road dimensions
    roadWidth = 2
    roadLength = 2

    // Internal
    _roadMesh = null
    _laneMeshes = []

    start() {
        if (super.start) super.start()
        this._createRoadGeometry()
    }

    stop() {
        if (super.stop) super.stop()
        this._removeRoadGeometry()
    }

    // ==================== ROAD GEOMETRY ====================

    _createRoadGeometry() {
        if (!this.object) return

        // Check if already has geometry
        let hasGeometry = false
        this.object.traverse((child) => {
            if (child.isMesh && child.geometry) {
                hasGeometry = true
            }
        })
        if (hasGeometry) return

        // Create road base (flat plane)
        const roadGeometry = new THREE.PlaneGeometry(this.roadWidth, this.roadLength)
        const roadMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,  // Dark asphalt
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        })

        this._roadMesh = new THREE.Mesh(roadGeometry, roadMaterial)
        this._roadMesh.rotation.x = -Math.PI / 2  // Lay flat on ground
        this._roadMesh.position.y = 0.01  // Slightly above ground to prevent z-fighting
        this._roadMesh.receiveShadow = true
        this._roadMesh.name = 'RoadBase'

        this.object.add(this._roadMesh)

        // Create lane markings (dashed white lines)
        this._createLaneMarkings()
    }

    _createLaneMarkings() {
        const laneWidth = 0.08
        const dashLength = 0.3
        const gapLength = 0.2
        const laneOffset = 0  // Center lane

        const laneMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide
        })

        // Create dashed center line
        const totalLength = this.roadLength
        let currentPos = -totalLength / 2 + dashLength / 2

        while (currentPos < totalLength / 2) {
            const dashGeometry = new THREE.PlaneGeometry(laneWidth, dashLength)
            const dashMesh = new THREE.Mesh(dashGeometry, laneMaterial)
            dashMesh.rotation.x = -Math.PI / 2
            dashMesh.position.set(laneOffset, 0.02, currentPos)
            dashMesh.name = 'LaneMarking'
            this.object.add(dashMesh)
            this._laneMeshes.push(dashMesh)

            currentPos += dashLength + gapLength
        }

        // Create edge lines (solid)
        const edgeGeometry = new THREE.PlaneGeometry(0.05, this.roadLength)
        const edgeMaterial = new THREE.MeshBasicMaterial({
            color: 0xcccccc,
            side: THREE.DoubleSide
        })

        // Left edge
        const leftEdge = new THREE.Mesh(edgeGeometry, edgeMaterial)
        leftEdge.rotation.x = -Math.PI / 2
        leftEdge.position.set(-this.roadWidth / 2 + 0.05, 0.02, 0)
        leftEdge.name = 'LaneMarking'
        this.object.add(leftEdge)
        this._laneMeshes.push(leftEdge)

        // Right edge
        const rightEdge = new THREE.Mesh(edgeGeometry, edgeMaterial)
        rightEdge.rotation.x = -Math.PI / 2
        rightEdge.position.set(this.roadWidth / 2 - 0.05, 0.02, 0)
        rightEdge.name = 'LaneMarking'
        this.object.add(rightEdge)
        this._laneMeshes.push(rightEdge)
    }

    _removeRoadGeometry() {
        if (!this.object) return

        // Remove road mesh
        if (this._roadMesh) {
            this._roadMesh.geometry?.dispose()
            this._roadMesh.material?.dispose()
            this.object.remove(this._roadMesh)
            this._roadMesh = null
        }

        // Remove lane markings
        for (const mesh of this._laneMeshes) {
            mesh.geometry?.dispose()
            mesh.material?.dispose()
            this.object.remove(mesh)
        }
        this._laneMeshes = []

        // Also remove by name (in case created differently)
        const toRemove = []
        this.object.traverse((child) => {
            if (child.name === 'RoadBase' || child.name === 'LaneMarking') {
                toRemove.push(child)
            }
        })

        for (const mesh of toRemove) {
            mesh.geometry?.dispose()
            mesh.material?.dispose()
            this.object.remove(mesh)
        }
    }

    // No update needed - purely visual
}
