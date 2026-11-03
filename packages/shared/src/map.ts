import { mulberry32, type Vec2 } from './math'
import { polygonFromRect, type Collider, type World } from './collision'

export type PropKind = 'house' | 'wall' | 'crate' | 'tree' | 'rock' | 'tower'

export interface PropDef {
  kind: PropKind
  x: number
  z: number
  rot: number
  w: number
  d: number
  h: number
  r: number
}

export interface MapDef {
  id: string
  width: number
  depth: number
  spawns: Vec2[]
  props: PropDef[]
}

export function terrainHeight(x: number, z: number): number {
  return (
    Math.sin(x * 0.03) * Math.cos(z * 0.026) * 0.7 +
    Math.sin((x + z) * 0.017) * 0.45
  )
}

function makeProp(kind: PropKind, x: number, z: number, extra: Partial<PropDef> = {}): PropDef {
  return { kind, x, z, rot: 0, w: 1, d: 1, h: 1, r: 0.5, ...extra }
}

function buildArenaProps(): PropDef[] {
  const props: PropDef[] = []

  const house = (x: number, z: number, rot = 0) =>
    props.push(makeProp('house', x, z, { w: 12, d: 9, h: 4.5, rot }))
  const wall = (x: number, z: number, w: number, d: number, rot = 0) =>
    props.push(makeProp('wall', x, z, { w, d, h: 3, rot }))
  const crate = (x: number, z: number) =>
    props.push(makeProp('crate', x, z, { w: 1.6, d: 1.6, h: 1.4 }))
  const tower = (x: number, z: number) =>
    props.push(makeProp('tower', x, z, { w: 6, d: 6, h: 7 }))

  // Aldea central
  house(112, 112)
  house(148, 112)
  house(112, 148)
  house(148, 148)
  tower(130, 130)
  crate(124, 124)
  crate(136, 138)
  crate(120, 140)
  crate(139, 122)

  // Ruinas al noroeste
  wall(50, 48, 18, 1.2)
  wall(50, 74, 18, 1.2)
  wall(41, 61, 1.2, 26)
  wall(68, 58, 1.2, 9)
  wall(62, 70, 1.2, 7, 0.4)
  crate(55, 55)
  crate(59, 64)
  crate(48, 68)

  // Cantera al suroeste
  wall(48, 190, 14, 1.2)
  wall(48, 222, 14, 1.2)
  wall(38, 206, 1.2, 20)
  crate(60, 205)
  crate(66, 214)

  // Campamento al sur
  crate(120, 222)
  crate(124, 226)
  crate(140, 222)
  wall(130, 232, 10, 1)

  // Colina al sureste: torre y muros
  tower(206, 200)
  wall(190, 214, 12, 1.2, 0.5)
  wall(222, 214, 12, 1.2, -0.5)

  const rng = mulberry32(20260101)

  // Bosque al noreste
  for (let i = 0; i < 26; i++) {
    props.push(
      makeProp('tree', 165 + rng() * 80, 25 + rng() * 70, { r: 0.35 + rng() * 0.15, h: 5.5 }),
    )
  }

  // Rocas: colina y cantera
  for (let i = 0; i < 16; i++) {
    props.push(
      makeProp('rock', 170 + rng() * 70, 168 + rng() * 72, { r: 0.9 + rng() * 0.9, h: 1.4 }),
    )
  }
  for (let i = 0; i < 10; i++) {
    props.push(
      makeProp('rock', 35 + rng() * 55, 170 + rng() * 65, { r: 0.9 + rng() * 0.9, h: 1.4 }),
    )
  }

  return props
}

export const ARENA_01: MapDef = {
  id: 'arena_01',
  width: 260,
  depth: 260,
  spawns: [
    { x: 20, z: 20 },
    { x: 130, z: 20 },
    { x: 240, z: 20 },
    { x: 20, z: 130 },
    { x: 240, z: 130 },
    { x: 20, z: 240 },
    { x: 130, z: 240 },
    { x: 240, z: 240 },
    { x: 65, z: 130 },
    { x: 195, z: 130 },
    { x: 130, z: 65 },
    { x: 130, z: 195 },
  ],
  props: buildArenaProps(),
}

const MAPS: Record<string, MapDef> = {
  arena_01: ARENA_01,
}

export function getMap(id: string): MapDef {
  const map = MAPS[id]
  if (!map) throw new Error(`Mapa desconocido: ${id}`)
  return map
}

export function buildWorld(map: MapDef): World {
  const colliders: Collider[] = []
  for (const prop of map.props) {
    if (prop.kind === 'tree' || prop.kind === 'rock') {
      colliders.push({ type: 'circle', x: prop.x, z: prop.z, radius: prop.r, height: prop.h })
    } else {
      colliders.push(polygonFromRect(prop.x, prop.z, prop.w, prop.d, prop.rot, prop.h))
    }
  }
  return {
    colliders,
    bounds: { minX: 2, maxX: map.width - 2, minZ: 2, maxZ: map.depth - 2 },
    heightAt: terrainHeight,
  }
}
