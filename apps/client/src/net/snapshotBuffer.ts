import {
  clamp,
  normalizeAngle,
  type BulletSnapshot,
  type PlayerSnapshot,
  type SnapshotMessage,
} from '@br/shared'

export interface SampledWorld {
  players: Map<number, PlayerSnapshot>
  bullets: Map<number, BulletSnapshot>
}

export class SnapshotBuffer {
  private readonly snapshots: SnapshotMessage[] = []

  push(snapshot: SnapshotMessage): void {
    const last = this.snapshots[this.snapshots.length - 1]
    if (last && snapshot.tick <= last.tick) {
      // Snapshot repetido o fuera de orden: se reemplaza el último.
      this.snapshots[this.snapshots.length - 1] = snapshot
      return
    }
    this.snapshots.push(snapshot)
    if (this.snapshots.length > 40) this.snapshots.shift()
  }

  clear(): void {
    this.snapshots.length = 0
  }

  get latest(): SnapshotMessage | null {
    return this.snapshots[this.snapshots.length - 1] ?? null
  }

  sample(tick: number): SampledWorld {
    const result: SampledWorld = { players: new Map(), bullets: new Map() }
    const snaps = this.snapshots
    if (snaps.length === 0) return result

    if (snaps.length === 1 || tick <= snaps[0].tick) {
      const s = snaps[0]
      for (const p of s.players) result.players.set(p.id, p)
      for (const b of s.bullets) result.bullets.set(b.id, b)
      return result
    }

    const last = snaps[snaps.length - 1]
    if (tick >= last.tick) {
      for (const p of last.players) result.players.set(p.id, p)
      for (const b of last.bullets) result.bullets.set(b.id, b)
      return result
    }

    let older = snaps[0]
    let newer = last
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].tick <= tick && snaps[i + 1].tick >= tick) {
        older = snaps[i]
        newer = snaps[i + 1]
        break
      }
    }

    const span = newer.tick - older.tick
    const t = span > 0 ? clamp((tick - older.tick) / span, 0, 1) : 0

    const newerPlayers = new Map(newer.players.map((p) => [p.id, p]))
    for (const p of newer.players) {
      const prev = older.players.find((q) => q.id === p.id)
      if (!prev) {
        result.players.set(p.id, p)
        continue
      }
      result.players.set(p.id, {
        ...p,
        x: prev.x + (p.x - prev.x) * t,
        z: prev.z + (p.z - prev.z) * t,
        aim: prev.aim + normalizeAngle(p.aim - prev.aim) * t,
      })
    }
    for (const p of older.players) {
      if (!newerPlayers.has(p.id)) result.players.set(p.id, p)
    }

    for (const b of newer.bullets) {      const prev = older.bullets.find((q) => q.id === b.id)
      if (!prev) {
        result.bullets.set(b.id, b)
        continue
      }
      result.bullets.set(b.id, {
        ...b,
        x: prev.x + (b.x - prev.x) * t,
        z: prev.z + (b.z - prev.z) * t,
      })
    }

    return result
  }
}
