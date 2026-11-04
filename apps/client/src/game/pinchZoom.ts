import { clamp } from '@br/shared'

export interface PinchZoomOptions {
  getViewHeight: () => number
  setViewHeight: (value: number) => void
  onActiveChange?: (active: boolean) => void
  minViewHeight?: number
  maxViewHeight?: number
}

interface TouchPoint {
  x: number
  y: number
}

/**
 * Los sticks ocupan mitades opuestas de la pantalla. Si los dos dedos están
 * en mitades distintas es el gesto normal de mover + disparar, no un zoom.
 */
function isSameHalf(a: TouchPoint, b: TouchPoint): boolean {
  const middle = window.innerWidth / 2
  return (a.x < middle && b.x < middle) || (a.x >= middle && b.x >= middle)
}

/**
 * Zoom por pellizco de dos dedos, equivalente a la rueda en escritorio:
 * separar los dedos acerca la cámara y juntarlos la aleja.
 *
 * Escucha en fase de captura sobre `window` porque las zonas de los sticks
 * cubren toda la pantalla y consumen los punteros del canvas.
 */
export class PinchZoom {
  private readonly points = new Map<number, TouchPoint>()
  private startDistance = 0
  private startViewHeight = 0
  private active = false

  constructor(private readonly options: PinchZoomOptions) {
    window.addEventListener('pointerdown', this.onPointerDown, {
      capture: true,
      passive: true,
    })
    window.addEventListener('pointermove', this.onPointerMove, {
      capture: true,
      passive: false,
    })
    window.addEventListener('pointerup', this.onPointerEnd, {
      capture: true,
      passive: true,
    })
    window.addEventListener('pointercancel', this.onPointerEnd, {
      capture: true,
      passive: true,
    })
    window.addEventListener('blur', this.reset)
  }

  get isActive(): boolean {
    return this.active
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return

    // Ignoramos dedos extra: el gesto siempre usa los dos primeros.
    if (this.points.size >= 2) return
    this.points.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.points.size === 2) {
      const [a, b] = [...this.points.values()]
      if (isSameHalf(a, b)) this.begin()
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.points.get(event.pointerId)
    if (!point) return

    point.x = event.clientX
    point.y = event.clientY

    if (!this.active || this.points.size < 2) return
    event.preventDefault()

    const [a, b] = [...this.points.values()]
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    const min = this.options.minViewHeight ?? 14
    const max = this.options.maxViewHeight ?? 34
    // Menos altura de vista = más cerca. Igual que la rueda hacia arriba.
    const next = this.startViewHeight * (this.startDistance / distance)
    this.options.setViewHeight(clamp(next, min, max))
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.points.delete(event.pointerId)) return
    if (this.points.size < 2) this.end()
  }

  private begin(): void {
    const [a, b] = [...this.points.values()]
    this.startDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
    this.startViewHeight = this.options.getViewHeight()
    this.active = true
    this.options.onActiveChange?.(true)
  }

  private end(): void {
    if (!this.active) return
    this.active = false
    this.options.onActiveChange?.(false)
  }

  private readonly reset = (): void => {
    this.points.clear()
    this.end()
  }
}
