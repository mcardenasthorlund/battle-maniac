import type { WebSocket } from 'ws'
import {
  BUTTON_FIRE,
  DT,
  MAX_HP,
  TICK_HZ,
  buildWorld,
  getMap,
  pointInPolygon,
  type SnapshotMessage,
} from '@br/shared'
import { Room } from '../rooms/room'

interface FakeSocket {
  readyState: number
  OPEN: number
  sent: string[]
  send: (data: string) => void
  close: () => void
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 1,
    OPEN: 1,
    sent: [],
    send(data: string) {
      socket.sent.push(data)
    },
    close() {
      socket.readyState = 3
    },
  }
  return socket
}

function asWs(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket
}

let failures = 0

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.error(`  FAIL ${label}`)
  }
}

function pushInput(room: Room, playerId: number, seq: number, moveX: number, moveZ: number, aim: number, buttons: number): void {
  const player = room.players.get(playerId)
  if (!player) return
  room.handleInput(player, { seq, moveX, moveZ, aim, buttons })
}

function lastSnapshot(socket: FakeSocket): SnapshotMessage | null {
  for (let i = socket.sent.length - 1; i >= 0; i--) {
    const parsed = JSON.parse(socket.sent[i]) as { t?: string }
    if (parsed.t === 'snapshot') return parsed as SnapshotMessage
  }
  return null
}

function allEvents(socket: FakeSocket): SnapshotMessage['events'] {
  const events: SnapshotMessage['events'] = []
  for (const raw of socket.sent) {
    const parsed = JSON.parse(raw) as { t?: string; events?: SnapshotMessage['events'] }
    if (parsed.t === 'snapshot' && parsed.events) events.push(...parsed.events)
  }
  return events
}

console.log('simulación')

// ---------------------------------------------------------------- Movimiento

{
  const room = new Room('test-move')
  const socket = fakeSocket()
  const player = room.addPlayer('A', asWs(socket))
  player.state.x = 100
  player.state.z = 100

  const startX = player.state.x
  for (let tick = 1; tick <= 30; tick++) {
    pushInput(room, player.id, tick, 1, 0, 0, 0)
    room.update(DT)
  }

  check(player.state.x > startX + 2, 'el jugador avanza al recibir movimiento')
  check(Number.isFinite(player.state.x) && Number.isFinite(player.state.z), 'posición finita')

  const snapshot = lastSnapshot(socket)
  check(snapshot !== null, 'se emiten snapshots')
  check((snapshot?.players.length ?? 0) === 1, 'el snapshot contiene al jugador')
}

// ---------------------------------------------------------------- Colisión

{
  const room = new Room('test-collision')
  const socket = fakeSocket()
  const player = room.addPlayer('A', asWs(socket))
  const map = getMap('arena_01')
  const world = buildWorld(map)

  // Colocar dentro de una casa de la aldea.
  player.state.x = 112
  player.state.z = 112
  room.update(DT)

  const inside = world.colliders.some(
    (collider) =>
      collider.type === 'poly' && pointInPolygon(collider.points, player.state.x, player.state.z),
  )
  check(!inside, 'el jugador es expulsado del interior de un edificio')

  // Empujar contra una pared durante un segundo.
  player.state.x = 100
  player.state.z = 112
  for (let tick = 1; tick <= 30; tick++) {
    pushInput(room, player.id, tick, 1, 0, 0, 0)
    room.update(DT)
  }
  check(player.state.x <= 106.5, 'la pared detiene el avance')
  check(Number.isFinite(player.state.x), 'la colisión no genera NaN')
}

// ---------------------------------------------------------------- Combate

{
  const room = new Room('test-combat')
  const socketA = fakeSocket()
  const socketB = fakeSocket()
  const attacker = room.addPlayer('Attacker', asWs(socketA))
  const target = room.addPlayer('Target', asWs(socketB))

  attacker.state.x = 100
  attacker.state.z = 100
  target.state.x = 106
  target.state.z = 100

  for (let tick = 1; tick <= 60; tick++) {
    pushInput(room, attacker.id, tick, 0, 0, 0, BUTTON_FIRE)
    room.update(DT)
  }

  check(target.state.hp < MAX_HP, 'el proyectil hace daño')
  check(!target.state.alive, 'el objetivo muere con daño suficiente')

  const snapshot = lastSnapshot(socketB)
  const events = allEvents(socketB)
  check(events.some((event) => event.k === 'hit'), 'se emite evento hit')
  check(events.some((event) => event.k === 'kill'), 'se emite evento kill')
  check(snapshot?.phase === 'over', 'la partida termina al quedar un solo jugador')
  check((snapshot?.alive ?? 0) === 1, 'el contador de vivos es correcto')

  // Reinicio tras la cuenta atrás.
  for (let tick = 0; tick < (8 + 1) * TICK_HZ; tick++) room.update(DT)
  check(attacker.state.alive && target.state.alive, 'los jugadores reaparecen al reiniciar')
  check(target.state.hp === MAX_HP, 'la vida se restaura al reiniciar')
}

// ---------------------------------------------------------------- Determinismo

{
  const run = (): string => {
    const room = new Room('test-determinism')
    const player = room.addPlayer('A', asWs(fakeSocket()))
    player.state.x = 90
    player.state.z = 90
    for (let tick = 1; tick <= 120; tick++) {
      const angle = tick * 0.05
      pushInput(room, player.id, tick, Math.cos(angle), Math.sin(angle), angle, tick % 10 === 0 ? BUTTON_FIRE : 0)
      room.update(DT)
    }
    return `${player.state.x.toFixed(6)},${player.state.z.toFixed(6)},${player.state.vx.toFixed(6)},${player.state.vz.toFixed(6)}`
  }

  const first = run()
  const second = run()
  check(first === second, `replay determinista (${first})`)
}

console.log(failures === 0 ? '\nTodo correcto' : `\n${failures} fallo(s)`)
if (failures > 0) process.exitCode = 1
