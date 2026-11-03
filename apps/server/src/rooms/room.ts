import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import {
  BULLET_DAMAGE,
  BULLET_LIFETIME,
  BULLET_RADIUS,
  BULLET_SPEED,
  BULLET_STEPS,
  BULLET_Y,
  BUTTON_FIRE,
  DISCONNECT_GRACE_MS,
  DT,
  FIRE_COOLDOWN,
  MATCH_RESTART_SECONDS,
  MATCH_MAX_SECONDS,
  MAX_HP,
  MAX_INPUT_QUEUE,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  SNAPSHOT_INTERVAL,
  TICK_HZ,
  buildWorld,
  getMap,
  neutralInput,
  pointBlocked,
  stepMovement,
  type BulletSnapshot,
  type GameEvent,
  type MapDef,
  type MatchPhase,
  type PlayerInfo,
  type PlayerInput,
  type PlayerSnapshot,
  type SnapshotMessage,
  type World,
} from '@br/shared'

export interface ServerPlayer {
  id: number
  token: string
  name: string
  color: string
  ws: WebSocket | null
  connected: boolean
  disconnectedAt: number | null
  state: {
    x: number
    z: number
    vx: number
    vz: number
    aim: number
    hp: number
    alive: boolean
  }
  queue: PlayerInput[]
  ack: number
  nextFireTick: number
}

interface ServerBullet {
  id: number
  x: number
  z: number
  vx: number
  vz: number
  owner: number
  life: number
  dead: boolean
}

function isOpen(ws: WebSocket | null): ws is WebSocket {
  return ws !== null && ws.readyState === ws.OPEN
}

export class Room {
  readonly id: string
  readonly map: MapDef
  readonly world: World
  readonly players = new Map<number, ServerPlayer>()

  private bullets: ServerBullet[] = []
  private tickCount = 0
  private phase: MatchPhase = 'live'
  private phaseEndTick = 0
  private liveEndTick = MATCH_MAX_SECONDS * TICK_HZ
  private nextPlayerId = 1
  private nextBulletId = 1
  private pendingEvents: GameEvent[] = []
  private snapshotAcc = 0
  private emptyFor = 0

  constructor(id: string) {
    this.id = id
    this.map = getMap('arena_01')
    this.world = buildWorld(this.map)
  }

  get playerCount(): number {
    return this.players.size
  }

  get isExpired(): boolean {
    return this.players.size === 0 && this.emptyFor > 60
  }

  addPlayer(name: string, ws: WebSocket): ServerPlayer {
    const id = this.nextPlayerId++
    const spawn = this.map.spawns[(id - 1) % this.map.spawns.length]
    const player: ServerPlayer = {
      id,
      token: randomUUID(),
      name,
      color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length],
      ws,
      connected: true,
      disconnectedAt: null,
      state: {
        x: spawn.x,
        z: spawn.z,
        vx: 0,
        vz: 0,
        aim: 0,
        hp: MAX_HP,
        alive: true,
      },
      queue: [],
      ack: 0,
      nextFireTick: 0,
    }
    this.players.set(id, player)
    this.broadcastRoster()
    return player
  }

  reattach(player: ServerPlayer, ws: WebSocket): void {
    if (player.ws && player.ws !== ws) {
      try {
        player.ws.close()
      } catch {
        // ignorado
      }
    }
    player.ws = ws
    player.connected = true
    player.disconnectedAt = null
    player.queue = []
    this.broadcastRoster()
  }

  markDisconnected(player: ServerPlayer): void {
    player.connected = false
    player.disconnectedAt = Date.now()
    player.ws = null
    player.queue = []
    this.broadcastRoster()
  }

  handleInput(player: ServerPlayer, input: PlayerInput): void {
    if (input.seq <= player.ack) return
    player.queue.push(input)
    if (player.queue.length > MAX_INPUT_QUEUE) player.queue.shift()
  }

  update(dt: number): void {
    this.tickCount++

    if (this.players.size === 0) this.emptyFor += dt
    else this.emptyFor = 0

    if (this.phase === 'over' && this.tickCount >= this.phaseEndTick) {
      this.restartMatch()
    }

    for (const player of this.players.values()) {
      if (!player.state.alive) {
        if (player.queue.length > 0) {
          player.ack = player.queue[player.queue.length - 1].seq
          player.queue.length = 0
        }
        continue
      }

      const queued = player.queue.shift()
      const input = queued ?? neutralInput(player.ack, player.state.aim)
      if (queued) player.ack = queued.seq

      stepMovement(player.state, input, this.world, dt)

      if ((input.buttons & BUTTON_FIRE) !== 0) {
        this.tryFire(player)
      }
    }

    this.updateBullets(dt)
    this.checkMatchEnd()
    this.cleanupDisconnected()

    this.snapshotAcc += dt
    if (this.snapshotAcc >= SNAPSHOT_INTERVAL) {
      this.snapshotAcc %= SNAPSHOT_INTERVAL
      this.broadcastSnapshots()
    }
  }

  private tryFire(player: ServerPlayer): void {
    if (this.tickCount < player.nextFireTick) return
    player.nextFireTick = this.tickCount + Math.max(1, Math.round(FIRE_COOLDOWN * TICK_HZ))

    const dx = Math.cos(player.state.aim)
    const dz = Math.sin(player.state.aim)
    const x = player.state.x + dx * 0.6
    const z = player.state.z + dz * 0.6

    this.bullets.push({
      id: this.nextBulletId++,
      x,
      z,
      vx: dx * BULLET_SPEED,
      vz: dz * BULLET_SPEED,
      owner: player.id,
      life: BULLET_LIFETIME,
      dead: false,
    })

    this.pendingEvents.push({ k: 'shot', by: player.id, x, z, dx, dz })
  }

  private updateBullets(dt: number): void {
    const stepDt = dt / BULLET_STEPS

    for (const bullet of this.bullets) {
      for (let step = 0; step < BULLET_STEPS && !bullet.dead; step++) {
        bullet.x += bullet.vx * stepDt
        bullet.z += bullet.vz * stepDt

        if (pointBlocked(this.world, bullet.x, bullet.z, BULLET_Y)) {
          bullet.dead = true
          break
        }

        for (const player of this.players.values()) {
          if (player.id === bullet.owner || !player.state.alive) continue
          const dx = player.state.x - bullet.x
          const dz = player.state.z - bullet.z
          const radius = PLAYER_RADIUS + BULLET_RADIUS
          if (dx * dx + dz * dz <= radius * radius) {
            this.applyDamage(player, bullet.owner, BULLET_DAMAGE, bullet.x, bullet.z)
            bullet.dead = true
            break
          }
        }
      }

      bullet.life -= dt
      if (bullet.life <= 0) bullet.dead = true
    }

    if (this.bullets.some((b) => b.dead)) {
      this.bullets = this.bullets.filter((b) => !b.dead)
    }
  }

  private applyDamage(
    target: ServerPlayer,
    by: number,
    dmg: number,
    x: number,
    z: number,
  ): void {
    if (!target.state.alive) return
    target.state.hp = Math.max(0, target.state.hp - dmg)
    this.pendingEvents.push({ k: 'hit', by, target: target.id, dmg, x, z })

    if (target.state.hp <= 0) {
      target.state.alive = false
      target.state.vx = 0
      target.state.vz = 0
      target.queue.length = 0
      this.pendingEvents.push({ k: 'kill', by, target: target.id })
      console.log(
        `[match] ${this.players.get(by)?.name ?? by} eliminó a ${target.name} (#${target.id}) · quedan ${this.aliveCount()} vivos`,
      )
    }
  }

  private aliveCount(): number {
    let alive = 0
    for (const player of this.players.values()) {
      if (player.state.alive) alive++
    }
    return alive
  }

  status(): {
    id: string
    players: number
    alive: number
    phase: MatchPhase
    bullets: number
    tick: number
    entities: Array<{ id: number; name: string; x: number; z: number; hp: number; alive: boolean }>
  } {
    return {
      id: this.id,
      players: this.players.size,
      alive: this.aliveCount(),
      phase: this.phase,
      bullets: this.bullets.length,
      tick: this.tickCount,
      entities: [...this.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        x: Math.round(player.state.x * 10) / 10,
        z: Math.round(player.state.z * 10) / 10,
        hp: player.state.hp,
        alive: player.state.alive,
      })),
    }
  }

  private checkMatchEnd(): void {
    if (this.phase !== 'live') return

    if (this.tickCount >= this.liveEndTick) {
      this.phase = 'over'
      this.phaseEndTick = this.tickCount + MATCH_RESTART_SECONDS * TICK_HZ
      this.bullets.length = 0
      console.log(`[match] tiempo agotado en la sala ${this.id}`)
      return
    }

    if (this.players.size < 2) return
    if (this.aliveCount() > 1) return

    this.phase = 'over'
    this.phaseEndTick = this.tickCount + MATCH_RESTART_SECONDS * TICK_HZ
    this.bullets.length = 0
    console.log(`[match] partida terminada en la sala ${this.id}`)
  }

  private restartMatch(): void {
    this.phase = 'live'
    this.phaseEndTick = 0
    this.liveEndTick = this.tickCount + MATCH_MAX_SECONDS * TICK_HZ
    this.bullets.length = 0
    this.pendingEvents.push({ k: 'restart' })

    for (const player of this.players.values()) {
      const spawn = this.map.spawns[(player.id - 1) % this.map.spawns.length]
      player.state.x = spawn.x
      player.state.z = spawn.z
      player.state.vx = 0
      player.state.vz = 0
      player.state.aim = 0
      player.state.hp = MAX_HP
      player.state.alive = true
      player.queue.length = 0
      player.nextFireTick = 0
    }
  }

  private cleanupDisconnected(): void {
    const now = Date.now()
    for (const [id, player] of this.players) {
      if (player.connected) continue
      if (player.disconnectedAt !== null && now - player.disconnectedAt > DISCONNECT_GRACE_MS) {
        this.players.delete(id)
        this.broadcastRoster()
      }
    }
  }

  private playerInfo(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color }))
  }

  broadcastRoster(): void {
    const payload = JSON.stringify({ t: 'roster', players: this.playerInfo() })
    for (const player of this.players.values()) {
      if (isOpen(player.ws)) player.ws.send(payload)
    }
  }

  sendRoster(ws: WebSocket): void {
    if (!isOpen(ws)) return
    ws.send(JSON.stringify({ t: 'roster', players: this.playerInfo() }))
  }

  private buildSnapshot(viewer: ServerPlayer): SnapshotMessage {
    const players: PlayerSnapshot[] = []
    for (const player of this.players.values()) {
      players.push({
        id: player.id,
        x: player.state.x,
        z: player.state.z,
        vx: player.state.vx,
        vz: player.state.vz,
        aim: player.state.aim,
        hp: player.state.hp,
        alive: player.state.alive,
      })
    }

    const bullets: BulletSnapshot[] = this.bullets.map((b) => ({
      id: b.id,
      x: b.x,
      z: b.z,
      vx: b.vx,
      vz: b.vz,
    }))

    const you = players.find((p) => p.id === viewer.id) ?? players[0]

    return {
      t: 'snapshot',
      tick: this.tickCount,
      ack: viewer.ack,
      you,
      players,
      bullets,
      events: this.pendingEvents,
      phase: this.phase,
      alive: this.aliveCount(),
      timeLeft:
        this.phase === 'over'
          ? Math.max(0, (this.phaseEndTick - this.tickCount) / TICK_HZ)
          : Math.max(0, (this.liveEndTick - this.tickCount) / TICK_HZ),
      serverTime: Date.now(),
    }
  }

  private broadcastSnapshots(): void {
    for (const player of this.players.values()) {
      if (!isOpen(player.ws)) continue
      player.ws.send(JSON.stringify(this.buildSnapshot(player)))
    }
    this.pendingEvents = []
  }
}

export { DT }
