import WebSocket from 'ws'
import {
  BUTTON_FIRE,
  TICK_HZ,
  angleDiff,
  clamp,
  getMap,
  type ClientMessage,
  type PlayerSnapshot,
  type ServerMessage,
  type SnapshotMessage,
  type Vec2,
} from '@br/shared'

interface Options {
  bots: number
  url: string
  room: string
  skill: 'easy' | 'normal' | 'hard'
}

function readOptions(): Options {
  const args = process.argv.slice(2)
  const value = (name: string, fallback: string): string => {
    const index = args.indexOf(`--${name}`)
    const next = index >= 0 ? args[index + 1] : undefined
    return next && !next.startsWith('--') ? next : fallback
  }
  const skill = value('skill', 'normal')
  return {
    bots: Math.max(1, Math.min(16, Number(value('bots', '4')) || 4)),
    url: value('url', 'ws://localhost:8080/ws'),
    room: value('room', 'dev'),
    skill: skill === 'easy' || skill === 'hard' ? skill : 'normal',
  }
}

const OPTIONS = readOptions()
const MAP = getMap('arena_01')

const SKILL = {
  easy: { aimError: 0.32, fireChance: 0.55, range: 12 },
  normal: { aimError: 0.14, fireChance: 0.8, range: 16 },
  hard: { aimError: 0.05, fireChance: 0.95, range: 20 },
}[OPTIONS.skill]

class Bot {
  private ws: WebSocket | null = null
  private id = -1
  private snapshot: SnapshotMessage | null = null
  private seq = 0
  private aim = 0
  private target: Vec2 = { x: 0, z: 0 }
  private strafeDir = Math.random() < 0.5 ? -1 : 1
  private strafeTimer = 0
  private lastPos = { x: 0, z: 0 }
  private stuckTimer = 0

  constructor(
    private readonly index: number,
    private readonly name: string,
    private readonly options: Options,
  ) {}

  start(): void {
    this.connect()
    setInterval(() => this.tick(), 1000 / TICK_HZ)
  }

  private connect(): void {
    const ws = new WebSocket(this.options.url)
    this.ws = ws

    ws.on('open', () => {
      this.id = -1
      this.snapshot = null
      this.send({ t: 'join', room: this.options.room, name: this.name })
    })

    ws.on('message', (raw) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(raw)) as ServerMessage
      } catch {
        return
      }
      if (message.t === 'welcome') {
        this.id = message.playerId
        this.pickTarget()
        console.log(`[bot] ${this.name} dentro (#${this.id})`)
      } else if (message.t === 'snapshot') {
        this.snapshot = message
      } else if (message.t === 'error') {
        console.warn(`[bot] ${this.name} error: ${message.code} ${message.message}`)
      }
    })

    ws.on('close', () => {
      console.log(`[bot] ${this.name} desconectado, reintentando…`)
      this.id = -1
      this.snapshot = null
      setTimeout(() => this.connect(), 2000)
    })

    ws.on('error', (error) => {
      console.warn(`[bot] ${this.name} ws error: ${error.message}`)
    })
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private pickTarget(): void {
    const spawns = MAP.spawns
    if (Math.random() < 0.55) {
      this.target = spawns[Math.floor(Math.random() * spawns.length)]
    } else {
      this.target = {
        x: 20 + Math.random() * (MAP.width - 40),
        z: 20 + Math.random() * (MAP.depth - 40),
      }
    }
  }

  private tick(): void {
    if (this.id < 0 || !this.snapshot) return

    const me = this.snapshot.players.find((player) => player.id === this.id)
    if (!me) return

    if (!me.alive) {
      this.seq++
      this.send({
        t: 'input',
        seq: this.seq,
        moveX: 0,
        moveZ: 0,
        aim: me.aim,
        buttons: 0,
      })
      return
    }

    this.updateStuck(me)

    let nearest: PlayerSnapshot | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const player of this.snapshot.players) {
      if (!player.alive || player.id === this.id) continue
      const d = Math.hypot(player.x - me.x, player.z - me.z)
      if (d < nearestDistance) {
        nearestDistance = d
        nearest = player
      }
    }

    let moveX = 0
    let moveZ = 0
    let fire = 0

    if (nearest && nearestDistance <= SKILL.range) {
      const dx = nearest.x - me.x
      const dz = nearest.z - me.z
      const d = Math.max(0.001, nearestDistance)

      this.aim = Math.atan2(dz, dx) + (Math.random() - 0.5) * SKILL.aimError

      this.strafeTimer += 1 / TICK_HZ
      if (this.strafeTimer > 1.2) {
        this.strafeTimer = 0
        this.strafeDir *= -1
      }

      const approach = d > 10 ? 0.65 : d < 5 ? -0.65 : 0
      moveX = (-dz / d) * this.strafeDir + (dx / d) * approach
      moveZ = (dx / d) * this.strafeDir + (dz / d) * approach

      const facing = Math.abs(angleDiff(me.aim, this.aim))
      if (facing < 0.35 && Math.random() < SKILL.fireChance) fire = 1
    } else {
      const dx = this.target.x - me.x
      const dz = this.target.z - me.z
      const d = Math.hypot(dx, dz)

      if (d < 3) {
        this.pickTarget()
      } else {
        moveX = dx / d
        moveZ = dz / d
        this.aim = Math.atan2(dz, dx)
      }
    }

    const length = Math.hypot(moveX, moveZ)
    if (length > 1) {
      moveX /= length
      moveZ /= length
    }

    this.seq++
    this.send({
      t: 'input',
      seq: this.seq,
      moveX: clamp(moveX, -1, 1),
      moveZ: clamp(moveZ, -1, 1),
      aim: this.aim,
      buttons: fire ? BUTTON_FIRE : 0,
    })
  }

  private updateStuck(me: PlayerSnapshot): void {
    const moved = Math.hypot(me.x - this.lastPos.x, me.z - this.lastPos.z)
    if (moved < 0.02) this.stuckTimer += 1 / TICK_HZ
    else this.stuckTimer = 0

    this.lastPos = { x: me.x, z: me.z }

    if (this.stuckTimer > 1.5) {
      this.stuckTimer = 0
      this.pickTarget()
    }
  }
}

console.log(
  `[bots] ${OPTIONS.bots} bots → ${OPTIONS.url} sala "${OPTIONS.room}" skill ${OPTIONS.skill}`,
)

const bots: Bot[] = []
for (let i = 0; i < OPTIONS.bots; i++) {
  const bot = new Bot(i, `Bot-${i + 1}`, OPTIONS)
  bots.push(bot)
  setTimeout(() => bot.start(), i * 80)
}
