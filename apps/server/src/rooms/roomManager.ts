import type { WebSocket } from 'ws'
import { MAX_PLAYERS } from '@br/shared'
import { Room, type ServerPlayer } from './room'

interface TokenLocation {
  roomId: string
  playerId: number
}

export interface JoinResult {
  room: Room
  player: ServerPlayer
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly tokens = new Map<string, TokenLocation>()

  get roomCount(): number {
    return this.rooms.size
  }

  getPlayerCount(): number {
    let total = 0
    for (const room of this.rooms.values()) total += room.playerCount
    return total
  }

  stats(): ReturnType<Room['status']>[] {
    return [...this.rooms.values()].map((room) => room.status())
  }

  getOrCreate(roomId: string): Room {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Room(roomId)
      this.rooms.set(roomId, room)
      console.log(`[room] creada ${roomId}`)
    }
    return room
  }

  join(roomId: string, name: string, token: string | undefined, ws: WebSocket): JoinResult | null {
    if (token) {
      const location = this.tokens.get(token)
      if (location && location.roomId === roomId) {
        const room = this.rooms.get(location.roomId)
        const player = room?.players.get(location.playerId)
        if (room && player) {
          room.reattach(player, ws)
          console.log(`[room] reconectado ${player.name} (#${player.id}) en ${room.id}`)
          return { room, player }
        }
        this.tokens.delete(token)
      }
    }

    if (token) {
      // El token no sirve: seguimos con un jugador nuevo, pero avisamos al cliente
      // mediante el welcome con un token distinto.
    }

    const room = this.getOrCreate(roomId)
    if (room.playerCount >= MAX_PLAYERS) return null

    const player = room.addPlayer(name, ws)
    this.tokens.set(player.token, { roomId: room.id, playerId: player.id })
    console.log(`[room] unido ${player.name} (#${player.id}) a ${room.id} (${room.playerCount})`)
    return { room, player }
  }

  update(dt: number): void {
    for (const [id, room] of this.rooms) {
      room.update(dt)
      if (room.isExpired) {
        this.rooms.delete(id)
        console.log(`[room] eliminada ${id} por inactividad`)
      }
    }
  }
}
