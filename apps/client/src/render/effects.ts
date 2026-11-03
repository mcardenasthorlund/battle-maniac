import * as THREE from 'three'
import { terrainHeight } from '@br/shared'

interface EffectItem {
  object: THREE.Object3D
  material: THREE.Material
  geometry: THREE.BufferGeometry | null
  life: number
  maxLife: number
  kind: 'tracer' | 'spark'
}

export class Effects {
  private readonly items: EffectItem[] = []

  constructor(private readonly scene: THREE.Scene) {}

  addTracer(x: number, z: number, dx: number, dz: number, color: string): void {
    const y = terrainHeight(x, z) + 1.2
    const length = 20
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x + dx * length, y, z + dz * length),
    ])
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    this.scene.add(line)
    this.items.push({ object: line, material, geometry, life: 0.09, maxLife: 0.09, kind: 'tracer' })
  }

  addImpact(x: number, z: number): void {
    const geometry = new THREE.SphereGeometry(0.12, 8, 6)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffcf6b,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, terrainHeight(x, z) + 1.1, z)
    this.scene.add(mesh)
    this.items.push({ object: mesh, material, geometry, life: 0.28, maxLife: 0.28, kind: 'spark' })
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      item.life -= dt
      const t = Math.max(0, item.life / item.maxLife)
      item.material.opacity = t

      if (item.kind === 'spark') {
        const scale = 1 + (1 - t) * 2.4
        item.object.scale.setScalar(scale)
      }

      if (item.life <= 0) {
        this.scene.remove(item.object)
        item.material.dispose()
        item.geometry?.dispose()
        this.items.splice(i, 1)
      }
    }
  }
}
