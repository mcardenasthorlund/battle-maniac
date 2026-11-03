import * as THREE from 'three'
import { terrainHeight } from '@br/shared'

const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 12)
const gunGeometry = new THREE.BoxGeometry(0.85, 0.14, 0.14)
const ringGeometry = new THREE.RingGeometry(0.55, 0.72, 24)

export class PlayerView {
  readonly group = new THREE.Group()
  private readonly bodyMaterial: THREE.MeshStandardMaterial
  private readonly ringMaterial: THREE.MeshBasicMaterial

  constructor(color: string, isLocal: boolean) {
    const bodyColor = new THREE.Color(color)
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.55,
      metalness: 0.15,
      emissive: bodyColor.clone().multiplyScalar(0.12),
    })

    const body = new THREE.Mesh(bodyGeometry, this.bodyMaterial)
    body.position.y = 0.9
    body.castShadow = true
    this.group.add(body)

    const gun = new THREE.Mesh(
      gunGeometry,
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4, metalness: 0.6 }),
    )
    gun.position.set(0.55, 1.12, 0)
    gun.castShadow = true
    this.group.add(gun)

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: isLocal ? 0x9fd0ff : 0xffffff,
      transparent: true,
      opacity: isLocal ? 0.75 : 0.25,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(ringGeometry, this.ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    this.group.add(ring)
  }

  setState(x: number, z: number, aim: number, alive: boolean): void {
    this.group.position.set(x, terrainHeight(x, z), z)
    this.group.rotation.y = -aim
    this.group.visible = alive
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      if (mesh.material !== this.bodyMaterial && mesh.material !== this.ringMaterial) {
        const material = mesh.material as THREE.Material | THREE.Material[]
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
    })
    this.bodyMaterial.dispose()
    this.ringMaterial.dispose()
  }
}
