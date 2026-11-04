import * as THREE from 'three'
import type { AimContext, InputIntent } from './input'

const DEADZONE = 0.15
const FIRE_THRESHOLD = 0.3

export interface TouchElements {
  leftZone: HTMLElement
  rightZone: HTMLElement
}

class Stick {
  pointerId: number | null = null
  x = 0
  y = 0
  private centerX = 0
  private centerY = 0

  constructor(
    private readonly zone: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly isBlocked: () => boolean = () => false,
  ) {
    zone.addEventListener('pointerdown', (event) => this.onDown(event))
    zone.addEventListener('pointermove', (event) => this.onMove(event))
    zone.addEventListener('pointerup', (event) => this.onUp(event))
    zone.addEventListener('pointercancel', (event) => this.onUp(event))
    zone.addEventListener('lostpointercapture', (event) => this.onUp(event))
  }

  get magnitude(): number {
    return Math.hypot(this.x, this.y)
  }

  reset(): void {
    this.pointerId = null
    this.x = 0
    this.y = 0
    this.base.classList.remove('active')
    this.knob.style.transform = 'translate(0px, 0px)'
  }

  private onDown(event: PointerEvent): void {
    if (this.pointerId !== null || this.isBlocked()) return
    event.preventDefault()

    this.pointerId = event.pointerId
    this.centerX = event.clientX
    this.centerY = event.clientY
    this.x = 0
    this.y = 0

    this.base.style.left = `${event.clientX}px`
    this.base.style.top = `${event.clientY}px`
    this.base.classList.add('active')
    this.knob.style.transform = 'translate(0px, 0px)'

    try {
      this.zone.setPointerCapture(event.pointerId)
    } catch {
      // Punteros sintéticos (tests) no se pueden capturar; no es un problema.
    }
  }

  private onMove(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return
    event.preventDefault()

    const maxRadius = Math.min(64, window.innerWidth * 0.11)
    const dx = event.clientX - this.centerX
    const dy = event.clientY - this.centerY
    const distance = Math.hypot(dx, dy)

    if (distance < 0.001) {
      this.x = 0
      this.y = 0
      this.knob.style.transform = 'translate(0px, 0px)'
      return
    }

    const clamped = Math.min(distance, maxRadius)
    const nx = dx / distance
    const ny = dy / distance
    this.x = nx * (clamped / maxRadius)
    this.y = ny * (clamped / maxRadius)
    this.knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`
  }

  private onUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return
    this.reset()
  }
}

/**
 * Doble stick virtual. El izquierdo mueve en ejes de pantalla y el derecho
 * apunta en mundo; al desviarlo se dispara automáticamente.
 */
export class TouchSource {
  private readonly left: Stick
  private readonly right: Stick
  private suspended = false

  private readonly basisRight = new THREE.Vector3(1, 0, 0)
  private readonly basisUp = new THREE.Vector3(0, 0, 1)

  constructor(
    private readonly camera: THREE.Camera,
    elements: TouchElements,
  ) {
    const blocked = (): boolean => this.suspended

    this.left = new Stick(
      elements.leftZone,
      elements.leftZone.querySelector('.stick-base') as HTMLElement,
      elements.leftZone.querySelector('.stick-knob') as HTMLElement,
      blocked,
    )
    this.right = new Stick(
      elements.rightZone,
      elements.rightZone.querySelector('.stick-base') as HTMLElement,
      elements.rightZone.querySelector('.stick-knob') as HTMLElement,
      blocked,
    )

    this.updateBasis()
    window.addEventListener('resize', () => this.updateBasis())
    window.addEventListener('orientationchange', () => this.updateBasis())
  }

  get firing(): boolean {
    return !this.suspended && this.right.magnitude > FIRE_THRESHOLD
  }

  /** Bloquea los sticks mientras dura un gesto de zoom con dos dedos. */
  setSuspended(value: boolean): void {
    if (this.suspended === value) return
    this.suspended = value
    if (value) this.reset()
  }

  reset(): void {
    this.left.reset()
    this.right.reset()
  }

  getIntent(ctx: AimContext): InputIntent {
    if (this.suspended) {
      return { moveX: 0, moveZ: 0, aim: ctx.aim, fire: false }
    }

    // La cámara se recoloca cada frame; la base debe recalcularse con ella.
    this.updateBasis()

    const magnitude = this.left.magnitude
    let sx = 0
    let sy = 0
    if (magnitude > DEADZONE) {
      const scale = Math.min(1, (magnitude - DEADZONE) / (1 - DEADZONE)) / magnitude
      sx = this.left.x * scale
      sy = this.left.y * scale
    }

    const move = this.toWorld(sx, sy)

    let aim = ctx.aim
    let fire = false
    if (this.right.magnitude > FIRE_THRESHOLD) {
      const dir = this.toWorld(this.right.x, this.right.y)
      if (Math.hypot(dir.x, dir.z) > 0.001) {
        aim = Math.atan2(dir.z, dir.x)
        fire = true
      }
    }

    return {
      moveX: move.x,
      moveZ: move.z,
      aim,
      fire: fire && ctx.alive,
    }
  }

  private updateBasis(): void {
    this.camera.updateMatrixWorld()
    this.basisRight.setFromMatrixColumn(this.camera.matrixWorld, 0)
    this.basisRight.y = 0
    if (this.basisRight.lengthSq() < 1e-6) this.basisRight.set(1, 0, 0)
    this.basisRight.normalize()

    this.basisUp.setFromMatrixColumn(this.camera.matrixWorld, 1)
    this.basisUp.y = 0
    if (this.basisUp.lengthSq() < 1e-6) this.basisUp.set(0, 0, -1)
    this.basisUp.normalize()
  }

  /** Stick (x derecha, y abajo) → vector en el plano XZ del mundo. */
  private toWorld(x: number, y: number): { x: number; z: number } {
    const wx = this.basisRight.x * x + this.basisUp.x * -y
    const wz = this.basisRight.z * x + this.basisUp.z * -y
    return { x: wx, z: wz }
  }
}
