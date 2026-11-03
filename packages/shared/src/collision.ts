import { clamp, type Vec2 } from './math'

export interface PolygonCollider {
  type: 'poly'
  points: Vec2[]
  height: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface CircleCollider {
  type: 'circle'
  x: number
  z: number
  radius: number
  height: number
}

export type Collider = PolygonCollider | CircleCollider

export interface WorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface World {
  colliders: Collider[]
  bounds: WorldBounds
  heightAt(x: number, z: number): number
}

export function polygonFromRect(
  x: number,
  z: number,
  width: number,
  depth: number,
  rot: number,
  height: number,
): PolygonCollider {
  const hw = width / 2
  const hd = depth / 2
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const local: Vec2[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ]
  const points = local.map((p) => ({
    x: x + p.x * c - p.z * s,
    z: z + p.x * s + p.z * c,
  }))
  return {
    type: 'poly',
    points,
    height,
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  }
}

export function pointInPolygon(points: Vec2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x
    const zi = points[i].z
    const xj = points[j].x
    const zj = points[j].z
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function closestOnSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): Vec2 {
  const abx = bx - ax
  const abz = bz - az
  const len2 = abx * abx + abz * abz
  const t = len2 === 0 ? 0 : clamp(((px - ax) * abx + (pz - az) * abz) / len2, 0, 1)
  return { x: ax + abx * t, z: az + abz * t }
}

function polygonCenter(poly: PolygonCollider): Vec2 {
  let x = 0
  let z = 0
  for (const p of poly.points) {
    x += p.x
    z += p.z
  }
  return { x: x / poly.points.length, z: z / poly.points.length }
}

function resolvePolygon(poly: PolygonCollider, p: { x: number; z: number }, radius: number): boolean {
  if (
    p.x < poly.minX - radius ||
    p.x > poly.maxX + radius ||
    p.z < poly.minZ - radius ||
    p.z > poly.maxZ + radius
  ) {
    return false
  }

  const inside = pointInPolygon(poly.points, p.x, p.z)
  let closest = { x: p.x, z: p.z }
  let closestDist = Number.POSITIVE_INFINITY

  for (let i = 0; i < poly.points.length; i++) {
    const a = poly.points[i]
    const b = poly.points[(i + 1) % poly.points.length]
    const q = closestOnSegment(a.x, a.z, b.x, b.z, p.x, p.z)
    const d = Math.hypot(p.x - q.x, p.z - q.z)
    if (d < closestDist) {
      closestDist = d
      closest = q
    }
  }

  if (inside) {
    let dx = closest.x - p.x
    let dz = closest.z - p.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-6) {
      const center = polygonCenter(poly)
      dx = p.x - center.x
      dz = p.z - center.z
      const dl = Math.hypot(dx, dz) || 1
      const push = radius + 0.001
      p.x += (dx / dl) * push
      p.z += (dz / dl) * push
      return true
    }
    const push = radius + closestDist
    p.x += (dx / d) * push
    p.z += (dz / d) * push
    return true
  }

  if (closestDist < radius) {
    const dx = p.x - closest.x
    const dz = p.z - closest.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-6) return false
    const push = radius - closestDist
    p.x += (dx / d) * push
    p.z += (dz / d) * push
    return true
  }

  return false
}

/** Resuelve el solapamiento de un círculo contra todos los colliders del mundo. */
export function resolveCircle(world: World, p: { x: number; z: number }, radius: number): boolean {
  let hit = false
  for (const collider of world.colliders) {
    if (collider.type === 'circle') {
      const dx = p.x - collider.x
      const dz = p.z - collider.z
      const r = collider.radius + radius
      const d2 = dx * dx + dz * dz
      if (d2 < r * r) {
        const d = Math.sqrt(d2)
        if (d < 1e-6) {
          p.x = collider.x + r
          p.z = collider.z
        } else {
          p.x = collider.x + (dx / d) * r
          p.z = collider.z + (dz / d) * r
        }
        hit = true
      }
    } else if (resolvePolygon(collider, p, radius)) {
      hit = true
    }
  }

  const b = world.bounds
  if (p.x < b.minX) {
    p.x = b.minX
    hit = true
  } else if (p.x > b.maxX) {
    p.x = b.maxX
    hit = true
  }
  if (p.z < b.minZ) {
    p.z = b.minZ
    hit = true
  } else if (p.z > b.maxZ) {
    p.z = b.maxZ
    hit = true
  }
  return hit
}

/** ¿Bloquea este punto de un proyectil a la altura dada? */
export function pointBlocked(world: World, x: number, z: number, y: number): boolean {
  for (const collider of world.colliders) {
    if (collider.height < y) continue
    if (collider.type === 'circle') {
      const dx = x - collider.x
      const dz = z - collider.z
      if (dx * dx + dz * dz < collider.radius * collider.radius) return true
    } else if (
      x >= collider.minX &&
      x <= collider.maxX &&
      z >= collider.minZ &&
      z <= collider.maxZ &&
      pointInPolygon(collider.points, x, z)
    ) {
      return true
    }
  }
  return false
}
