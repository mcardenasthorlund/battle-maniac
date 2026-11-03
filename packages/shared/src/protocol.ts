export const BUTTON_FIRE = 1
export const BUTTON_SPRINT = 2

export interface PlayerInput {
  seq: number
  moveX: number
  moveZ: number
  aim: number
  buttons: number
}

export type MatchPhase = 'live' | 'over'

export interface PlayerInfo {
  id: number
  name: string
  color: string
}

export interface PlayerSnapshot {
  id: number
  x: number
  z: number
  vx: number
  vz: number
  aim: number
  hp: number
  alive: boolean
}

export interface BulletSnapshot {
  id: number
  x: number
  z: number
  vx: number
  vz: number
}

export type GameEvent =
  | { k: 'shot'; by: number; x: number; z: number; dx: number; dz: number }
  | { k: 'hit'; by: number; target: number; dmg: number; x: number; z: number }
  | { k: 'kill'; by: number; target: number }
  | { k: 'restart' }

export interface SnapshotMessage {
  t: 'snapshot'
  tick: number
  ack: number
  you: PlayerSnapshot
  players: PlayerSnapshot[]
  bullets: BulletSnapshot[]
  events: GameEvent[]
  phase: MatchPhase
  alive: number
  timeLeft: number
  serverTime: number
}

export type ClientMessage =
  | { t: 'join'; room: string; name: string; token?: string }
  | { t: 'input'; seq: number; moveX: number; moveZ: number; aim: number; buttons: number }
  | { t: 'ping'; id: number; clientTime: number }

export type ServerMessage =
  | {
      t: 'welcome'
      playerId: number
      token: string
      room: string
      mapId: string
      tickRate: number
    }
  | { t: 'roster'; players: PlayerInfo[] }
  | SnapshotMessage
  | { t: 'pong'; id: number; clientTime: number; serverTime: number }
  | { t: 'error'; code: string; message: string }
