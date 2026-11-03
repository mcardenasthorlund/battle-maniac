import * as THREE from 'three'
import { TouchSource, type TouchElements } from './touchControls'

export interface InputIntent {
  moveX: number
  moveZ: number
  aim: number
  fire: boolean
}

export interface AimContext {
  x: number
  z: number
  groundY: number
  aim: number
  alive: boolean
}

/** Teclado + ratón: movimiento relativo al apuntado y aim por raycast. */
export class KeyboardMouseSource {
  firing = false
  private readonly keys = new Set<string>()
  private readonly ndc = new THREE.Vector2(0, 0)
  private readonly raycaster = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly hit = new THREE.Vector3()

  constructor(
    private readonly camera: THREE.Camera,
    canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code)
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) {
        event.preventDefault()
      }
    })
    window.addEventListener('keyup', (event) => this.keys.delete(event.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.firing = false
    })

    canvas.addEventListener('mousemove', (event) => {
      this.ndc.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
      )
    })
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.firing = true
    })
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.firing = false
    })
    canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  /** Punto del mundo bajo el cursor sobre el plano horizontal a la altura dada. */
  aimPoint(groundY: number): { x: number; z: number } {
    this.plane.constant = -groundY
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const point = this.raycaster.ray.intersectPlane(this.plane, this.hit)
    if (!point) return { x: 0, z: 0 }
    return { x: point.x, z: point.z }
  }

  getIntent(ctx: AimContext): InputIntent {
    const point = this.aimPoint(ctx.groundY)
    const toAimX = point.x - ctx.x
    const toAimZ = point.z - ctx.z

    let aim = ctx.aim
    if (Math.hypot(toAimX, toAimZ) > 1) aim = Math.atan2(toAimZ, toAimX)

    let forward = 0
    let right = 0
    if (this.keys.has('KeyW')) forward += 1
    if (this.keys.has('KeyS')) forward -= 1
    if (this.keys.has('KeyD')) right += 1
    if (this.keys.has('KeyA')) right -= 1

    const fx = Math.cos(aim)
    const fz = Math.sin(aim)
    const rx = -fz
    const rz = fx

    return {
      moveX: fx * forward + rx * right,
      moveZ: fz * forward + rz * right,
      aim,
      fire: this.firing && ctx.alive,
    }
  }
}

/**
 * Fachada de entrada: elige entre teclado/ratón y táctil según el último
 * dispositivo usado, y expone una única intención de juego.
 */
export class InputManager {
  readonly keyboard: KeyboardMouseSource
  readonly touch: TouchSource
  private touchMode: boolean
  onModeChange: ((isTouch: boolean) => void) | null = null

  constructor(
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    touchElements: TouchElements,
    initialTouch: boolean,
  ) {
    this.keyboard = new KeyboardMouseSource(camera, canvas)
    this.touch = new TouchSource(camera, touchElements)
    this.touchMode = initialTouch

    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch') this.setTouchMode(true)
      },
      { capture: true, passive: true },
    )

    window.addEventListener('keydown', (event) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      this.setTouchMode(false)
    })

    window.addEventListener('blur', () => {
      this.keyboard.firing = false
      this.touch.reset()
    })
  }

  get isTouch(): boolean {
    return this.touchMode
  }

  get firing(): boolean {
    return this.touchMode ? this.touch.firing : this.keyboard.firing
  }

  getIntent(ctx: AimContext): InputIntent {
    return this.touchMode ? this.touch.getIntent(ctx) : this.keyboard.getIntent(ctx)
  }

  setTouchMode(value: boolean): void {
    if (value === this.touchMode) return
    this.touchMode = value
    this.touch.reset()
    this.keyboard.firing = false
    this.onModeChange?.(value)
  }
}
