import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { DT, MAX_INPUT_HZ, TICK_HZ } from '@br/shared'
import { RoomManager } from './rooms/roomManager'
import type { Room, ServerPlayer } from './rooms/room'
import { parseClientMessage, sanitizeName, sanitizeRoom } from './net/validation'

const PORT = Number(process.env.PORT ?? 8080)
const here = fileURLToPath(new URL('.', import.meta.url))
const clientDist = resolve(here, '../../client/dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.ico': 'image/x-icon',
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        uptime: process.uptime(),
        rooms: manager.roomCount,
        players: manager.getPlayerCount(),
        detail: manager.stats(),
      }),
    )
    return
  }

  if (!existsSync(clientDist)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(
      'Cliente no compilado. En desarrollo abre http://localhost:5173 (Vite).\n' +
        'Para servir el build: npm run build',
    )
    return
  }

  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const filePath = resolve(clientDist, '.' + pathname)
  const insideDist = filePath === clientDist || filePath.startsWith(clientDist + sep)

  if (!insideDist || !existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    const indexPath = join(clientDist, 'index.html')
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(readFileSync(indexPath))
    return
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  res.end(readFileSync(filePath))
}

const manager = new RoomManager()

const server = createServer((req, res) => {
  try {
    serveStatic(req, res)
  } catch (error) {
    console.error('[http] error', error)
    res.writeHead(500)
    res.end('internal error')
  }
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

interface Session {
  room: Room
  player: ServerPlayer
}

const sessions = new Map<WebSocket, Session>()
const rateLimits = new WeakMap<WebSocket, { count: number; resetAt: number }>()

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { t: 'error', code, message })
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : raw.toString()
    if (text.length > 4096) return

    const message = parseClientMessage(text)
    if (!message) {
      sendError(ws, 'bad_message', 'Mensaje inválido')
      return
    }

    if (message.t === 'ping') {
      send(ws, { t: 'pong', id: message.id, clientTime: message.clientTime, serverTime: Date.now() })
      return
    }

    if (message.t === 'join') {
      if (sessions.has(ws)) {
        sendError(ws, 'already_joined', 'Ya estás en una sala')
        return
      }
      const roomId = sanitizeRoom(message.room) || 'dev'
      const name = sanitizeName(message.name) || 'Jugador'
      const result = manager.join(roomId, name, message.token, ws)
      if (!result) {
        sendError(ws, 'room_full', 'La sala está llena')
        return
      }
      sessions.set(ws, result)
      send(ws, {
        t: 'welcome',
        playerId: result.player.id,
        token: result.player.token,
        room: result.room.id,
        mapId: result.room.map.id,
        tickRate: TICK_HZ,
      })
      result.room.sendRoster(ws)
      return
    }

    if (message.t === 'input') {
      const session = sessions.get(ws)
      if (!session) return

      const now = Date.now()
      let limit = rateLimits.get(ws)
      if (!limit || now >= limit.resetAt) {
        limit = { count: 0, resetAt: now + 1000 }
        rateLimits.set(ws, limit)
      }
      limit.count++
      if (limit.count > MAX_INPUT_HZ * 2) {
        sendError(ws, 'rate_limited', 'Demasiados inputs')
        ws.close(1008, 'rate limited')
        return
      }

      session.room.handleInput(session.player, message)
    }
  })

  ws.on('close', () => {
    const session = sessions.get(ws)
    if (session) {
      session.room.markDisconnected(session.player)
      sessions.delete(ws)
      console.log(
        `[room] desconectado ${session.player.name} (#${session.player.id}) de ${session.room.id}`,
      )
    }
  })

  ws.on('error', (error) => {
    console.warn('[ws] error', error.message)
  })
})

let accumulator = 0
let last = performance.now()

setInterval(() => {
  const now = performance.now()
  accumulator += (now - last) / 1000
  last = now

  let steps = 0
  while (accumulator >= DT && steps < 8) {
    manager.update(DT)
    accumulator -= DT
    steps++
  }
  if (steps >= 8) accumulator = 0
}, 5)

server.listen(PORT, () => {
  console.log(`[server] escuchando en http://localhost:${PORT} (ws: /ws)`)
  if (!existsSync(clientDist)) {
    console.log('[server] cliente sin compilar: usa Vite en http://localhost:5173')
  }
})

function shutdown(): void {
  console.log('[server] cerrando...')
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
