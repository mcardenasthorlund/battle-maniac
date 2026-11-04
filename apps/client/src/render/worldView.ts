import * as THREE from 'three'
import {
  mulberry32,
  terrainHeight,
  type BridgeDef,
  type LakeDef,
  type MapDef,
  type PropDef,
  type Vec2,
} from '@br/shared'

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

/**
 * Malla radial que sigue el contorno orgánico del lago y se adapta a la
 * altura del terreno. `scale` permite dibujar una orilla algo mayor.
 */
function buildLakeLobeGeometry(
  center: Vec2,
  outline: Vec2[],
  scale: number,
  lift: number,
  rings = 4,
): THREE.BufferGeometry {
  const count = outline.length
  const positions: number[] = []
  const indices: number[] = []

  positions.push(center.x, terrainHeight(center.x, center.z) + lift, center.z)

  for (let ring = 1; ring <= rings; ring++) {
    const factor = (ring / rings) * scale
    for (const point of outline) {
      const x = center.x + (point.x - center.x) * factor
      const z = center.z + (point.z - center.z) * factor
      positions.push(x, terrainHeight(x, z) + lift, z)
    }
  }

  for (let i = 0; i < count; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % count))
  }

  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * count
    const outer = 1 + ring * count
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      indices.push(inner + i, outer + i, outer + next)
      indices.push(inner + i, outer + next, inner + next)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function addLake(parent: THREE.Group, lake: LakeDef): void {
  const shoreMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f6547,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f7f9e,
    roughness: 0.25,
    metalness: 0.12,
    emissive: 0x071a22,
    side: THREE.DoubleSide,
  })

  for (const lobe of lake.lobes) {
    const shore = new THREE.Mesh(
      buildLakeLobeGeometry(lobe.center, lobe.outline, 1.06, 0.035),
      shoreMaterial,
    )
    shore.name = 'lake-shore'
    shore.receiveShadow = true
    parent.add(shore)

    const water = new THREE.Mesh(
      buildLakeLobeGeometry(lobe.center, lobe.outline, 1, 0.07),
      waterMaterial,
    )
    water.name = 'lake-water'
    water.receiveShadow = true
    parent.add(water)
  }

  addBridge(parent, lake.bridge)
}

function addBridge(parent: THREE.Group, bridge: BridgeDef): void {
  const plankCount = 32
  const plankWidth = bridge.w / plankCount
  const plankHeight = 0.14
  const deckLift = 0.11
  const plankMaterials = [
    makeMaterial(0x6d4f2c, 0.85),
    makeMaterial(0x7a5a33, 0.85),
  ]
  const curbMaterial = makeMaterial(0x4b3721, 0.9)

  for (let i = 0; i < plankCount; i++) {
    const x = bridge.x - bridge.w / 2 + plankWidth * (i + 0.5)
    const groundY = Math.max(
      terrainHeight(x, bridge.z - bridge.d / 2),
      terrainHeight(x, bridge.z),
      terrainHeight(x, bridge.z + bridge.d / 2),
    )

    const plank = new THREE.Mesh(boxGeometry, plankMaterials[i % plankMaterials.length])
    plank.scale.set(plankWidth - 0.06, plankHeight, bridge.d)
    plank.position.set(x, groundY + deckLift + plankHeight / 2, bridge.z)
    plank.castShadow = true
    plank.receiveShadow = true
    parent.add(plank)

    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(boxGeometry, curbMaterial)
      curb.scale.set(plankWidth - 0.06, 0.2, 0.16)
      curb.position.set(
        x,
        groundY + deckLift + plankHeight + 0.08,
        bridge.z + side * (bridge.d / 2 - 0.08),
      )
      curb.castShadow = true
      parent.add(curb)
    }
  }
}

/**
 * Pegatina del logo en el suelo, en el centro del mapa. La geometría se
 * segmenta y adapta a la altura del terreno para que quede totalmente pegada.
 */
function addFloorSticker(parent: THREE.Group, map: MapDef): void {
  const size = 16
  const geometry = new THREE.PlaneGeometry(size, size, 24, 24)
  geometry.rotateX(-Math.PI / 2)
  // Gira la imagen para que se lea de frente desde la cámara isométrica.
  geometry.rotateY(Math.PI / 4)
  // Ligeramente al norte del centro para que la torre central no lo tape.
  geometry.translate(map.width / 2, 0, map.depth / 2 - 15)

  const positions = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)) + 0.04)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()

  const texture = new THREE.TextureLoader().load('/Logo-Maniac.png')
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8

  const sticker = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  )
  sticker.name = 'floor-logo-sticker'
  // Se dibuja antes que los demás elementos transparentes (disparos, impactos).
  sticker.renderOrder = -1
  parent.add(sticker)
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

  addFloorSticker(group, map)
  if (map.lake) addLake(group, map.lake)

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
