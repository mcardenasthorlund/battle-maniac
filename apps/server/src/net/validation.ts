import { MAX_NAME_LENGTH, type ClientMessage } from '@br/shared'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned.slice(0, MAX_NAME_LENGTH)
}

export function sanitizeRoom(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 16)
}

/** Devuelve null si el mensaje no es válido. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null

  const msg = data as Record<string, unknown>

  switch (msg.t) {
    case 'join': {
      if (typeof msg.room !== 'string' || typeof msg.name !== 'string') return null
      if (msg.token !== undefined && typeof msg.token !== 'string') return null
      return {
        t: 'join',
        room: msg.room,
        name: msg.name,
        token: msg.token as string | undefined,
      }
    }
    case 'input': {
      if (!isFiniteNumber(msg.seq) || !Number.isInteger(msg.seq) || msg.seq < 0) return null
      if (!isFiniteNumber(msg.moveX) || Math.abs(msg.moveX) > 1.01) return null
      if (!isFiniteNumber(msg.moveZ) || Math.abs(msg.moveZ) > 1.01) return null
      if (!isFiniteNumber(msg.aim)) return null
      if (!isFiniteNumber(msg.buttons)) return null
      return {
        t: 'input',
        seq: msg.seq,
        moveX: msg.moveX,
        moveZ: msg.moveZ,
        aim: msg.aim,
        buttons: msg.buttons | 0,
      }
    }
    case 'ping': {
      if (!isFiniteNumber(msg.id) || !isFiniteNumber(msg.clientTime)) return null
      return { t: 'ping', id: msg.id, clientTime: msg.clientTime }
    }
    default:
      return null
  }
}
