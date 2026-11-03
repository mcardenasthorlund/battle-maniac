import * as THREE from 'three'
import { mulberry32, terrainHeight, type MapDef, type PropDef } from '@br/shared'

export interface WorldView {
  group: THREE.Group
  occluders: THREE.Object3D[]
}

const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
const coneGeometry = new THREE.ConeGeometry(1, 1, 4)
const coneRoundGeometry = new THREE.ConeGeometry(1, 1, 8)
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 8)
const rockGeometry = new THREE.IcosahedronGeometry(1, 0)

const COLORS = {
  house: 0x6b5c4a,
  roof: 0x8a4b3a,
  wall: 0x7c7568,
  crate: 0x8f7040,
  tower: 0x6f6a5e,
  trunk: 0x5a4630,
  leaves: 0x3f6b3a,
  leavesDark: 0x33552f,
  rock: 0x6b6f73,
  terrain: 0x3f4c36,
}

function makeMaterial(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, flatShading: true })
}

/**
 * Textura de terreno generada en canvas: manchas, motas y una rejilla tenue
 * cada 10 m. Al repetirse, el movimiento se percibe con claridad.
 */
function createGroundTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D no disponible')

  ctx.fillStyle = '#3c4a33'
  ctx.fillRect(0, 0, size, size)

  const rng = mulberry32(20260202)

  // Manchas grandes, dibujadas 9 veces para que el tile sea continuo.
  for (let i = 0; i < 70; i++) {
    const x = rng() * size
    const y = rng() * size
    const radius = 12 + rng() * 46
    ctx.fillStyle = rng() > 0.5 ? 'rgba(78, 94, 60, 0.16)' : 'rgba(32, 42, 27, 0.16)'
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath()
        ctx.arc(x + ox, y + oy, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // Motas: hierba, piedras y tierra.
  for (let i = 0; i < 2200; i++) {
    const x = rng() * size
    const y = rng() * size
    const s = 1 + rng() * 2.6
    const kind = rng()
    ctx.fillStyle =
      kind < 0.5
        ? 'rgba(28, 38, 24, 0.25)'
        : kind < 0.85
          ? 'rgba(104, 120, 78, 0.20)'
          : 'rgba(132, 118, 88, 0.16)'
    ctx.fillRect(x, y, s, s)
  }

  // Rejilla tenue en el borde del tile (cada 10 m en el mundo).
  ctx.strokeStyle = 'rgba(14, 19, 12, 0.22)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function addProp(scene: THREE.Group, prop: PropDef): THREE.Object3D {
  const propGroup = new THREE.Group()
  propGroup.userData.propRoot = true
  propGroup.position.set(prop.x, terrainHeight(prop.x, prop.z), prop.z)
  propGroup.rotation.y = -prop.rot

  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    scale: [number, number, number],
    position: [number, number, number],
    rotationY = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(scale[0], scale[1], scale[2])
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.y = rotationY
    mesh.castShadow = true
    mesh.receiveShadow = true
    propGroup.add(mesh)
    return mesh
  }

  switch (prop.kind) {
    case 'house': {
      const body = makeMaterial(COLORS.house)
      addMesh(boxGeometry, body, [prop.w, prop.h, prop.d], [0, prop.h / 2, 0])
      const roof = makeMaterial(COLORS.roof, 0.8)
      const roofSize = Math.max(prop.w, prop.d) * 0.78
      addMesh(coneGeometry, roof, [roofSize, 3.2, roofSize], [0, prop.h + 1.6, 0], Math.PI / 4)
      break
    }
    case 'tower': {
      const body = makeMaterial(COLORS.tower)
      addMesh(boxGeometry, body, [prop.w, prop.h, prop.d], [0, prop.h / 2, 0])
      const roof = makeMaterial(COLORS.roof, 0.8)
      addMesh(coneGeometry, roof, [prop.w * 0.95, 2.4, prop.d * 0.95], [0, prop.h + 1.2, 0], Math.PI / 4)
      break
    }
    case 'wall': {
      const body = makeMaterial(COLORS.wall)
      addMesh(boxGeometry, body, [prop.w, prop.h, prop.d], [0, prop.h / 2, 0])
      break
    }
    case 'crate': {
      const body = makeMaterial(COLORS.crate, 0.85)
      addMesh(boxGeometry, body, [prop.w, prop.h, prop.d], [0, prop.h / 2, 0], prop.rot * 0.3)
      break
    }
    case 'tree': {
      const trunkMat = makeMaterial(COLORS.trunk)
      addMesh(cylinderGeometry, trunkMat, [0.28, 2.4, 0.28], [0, 1.2, 0])
      const leaves = makeMaterial(COLORS.leaves, 0.95)
      addMesh(coneRoundGeometry, leaves, [1.9, 4.2, 1.9], [0, 4.1, 0])
      const leavesDark = makeMaterial(COLORS.leavesDark, 0.95)
      addMesh(coneRoundGeometry, leavesDark, [1.3, 2.6, 1.3], [0, 5.6, 0])
      break
    }
    case 'rock': {
      const body = makeMaterial(COLORS.rock, 1)
      addMesh(rockGeometry, body, [prop.r, prop.h * 0.75, prop.r * 1.15], [0, prop.h * 0.32, 0], prop.x * 0.7)
      break
    }
  }

  scene.add(propGroup)
  return propGroup
}

export function buildWorldView(map: MapDef, scene: THREE.Scene): WorldView {
  const group = new THREE.Group()
  group.name = 'world'
  scene.add(group)

  // Terreno (se extiende más allá de los límites jugables para evitar el vacío)
  const terrainSize = Math.max(map.width, map.depth) + 140
  const segments = 160
  const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(map.width / 2, 0, map.depth / 2)

  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, terrainHeight(x, z))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()

  const terrain = new THREE.Mesh(
    geometry,
    (() => {
      const texture = createGroundTexture()
      texture.repeat.set(terrainSize / 10, terrainSize / 10)
      return new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
      })
    })(),
  )
  terrain.receiveShadow = true
  terrain.name = 'terrain'
  group.add(terrain)

  const occluders: THREE.Object3D[] = []

  for (const prop of map.props) {
    const propGroup = addProp(group, prop)
    if (prop.kind === 'house' || prop.kind === 'tower' || prop.kind === 'wall' || prop.kind === 'tree') {
      occluders.push(propGroup)
    }
  }

  return { group, occluders }
}

export function setFaded(object: THREE.Object3D, faded: boolean): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const mat = material as THREE.MeshStandardMaterial
      if (faded) {
        mat.transparent = true
        mat.opacity = 0.18
        mat.depthWrite = false
      } else {
        mat.opacity = 1
        mat.transparent = false
        mat.depthWrite = true
      }
    }
  })
}
