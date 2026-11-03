import type { ClientMessage, ServerMessage } from '@br/shared'

type Message<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>

export interface ConnectionHandlers {
  onWelcome?: (msg: Message<'welcome'>) => void
  onRoster?: (msg: Message<'roster'>) => void
  onSnapshot?: (msg: Message<'snapshot'>) => void
  onPong?: (msg: Message<'pong'>) => void
  onServerError?: (code: string, message: string) => void
  onOpen?: () => void
  onClose?: () => void
}

export class GameConnection {
  private ws: WebSocket | null = null
  private pingTimer: number | null = null
  private pingId = 0
  latency = 0

  constructor(private readonly handlers: ConnectionHandlers) {}

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = () => {
      this.pingId = 0
      this.startPing()
      this.handlers.onOpen?.()
    }

    ws.onclose = () => {
      this.stopPing()
      if (this.ws === ws) this.ws = null
      this.handlers.onClose?.()
    }

    ws.onerror = () => {
      // onclose se encarga de la reconexión
    }

    ws.onmessage = (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return
      }
      this.dispatch(message)
    }
  }

  send(message: ClientMessage): void {
    if (!this.connected || !this.ws) return
    this.ws.send(JSON.stringify(message))
  }

  close(): void {
    this.stopPing()
    this.ws?.close()
    this.ws = null
  }

  private dispatch(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.handlers.onWelcome?.(message)
        break
      case 'roster':
        this.handlers.onRoster?.(message)
        break
      case 'snapshot':
        this.handlers.onSnapshot?.(message)
        break
      case 'pong':
        this.latency = Math.max(0, performance.now() - message.clientTime)
        this.handlers.onPong?.(message)
        break
      case 'error':
        this.handlers.onServerError?.(message.code, message.message)
        break
    }
  }

  private startPing(): void {
    this.pingTimer = window.setInterval(() => {
      this.pingId++
      this.send({ t: 'ping', id: this.pingId, clientTime: performance.now() })
    }, 2000)
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }
}
