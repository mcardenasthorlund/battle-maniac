import { PLAYER_ACCEL, PLAYER_RADIUS, PLAYER_SPEED, DT } from './constants'
import { resolveCircle, type World } from './collision'
import { clamp } from './math'
import type { PlayerInput } from './protocol'

export interface MovementState {
  x: number
  z: number
  vx: number
  vz: number
  aim: number
}

export function neutralInput(seq: number, aim = 0): PlayerInput {
  return { seq, moveX: 0, moveZ: 0, aim, buttons: 0 }
}

/**
 * Avanza un jugador un tick fijo. Función pura compartida por cliente y servidor:
 * cualquier divergencia aquí se convierte en desincronización.
 */
export function stepMovement(
  state: MovementState,
  input: PlayerInput,
  world: World,
  dt: number = DT,
): void {
  let mx = input.moveX
  let mz = input.moveZ
  const len = Math.hypot(mx, mz)
  if (len > 1) {
    mx /= len
    mz /= len
  }

  const targetVx = mx * PLAYER_SPEED
  const targetVz = mz * PLAYER_SPEED
  const maxDelta = PLAYER_ACCEL * dt

  state.vx += clamp(targetVx - state.vx, -maxDelta, maxDelta)
  state.vz += clamp(targetVz - state.vz, -maxDelta, maxDelta)

  const prevX = state.x
  const prevZ = state.z

  state.x += state.vx * dt
  state.z += state.vz * dt

  resolveCircle(world, state, PLAYER_RADIUS)
  resolveCircle(world, state, PLAYER_RADIUS)

  // La velocidad refleja el desplazamiento real: al chocar contra un muro se anula
  // y el deslizamiento no acumula energía.
  state.vx = (state.x - prevX) / dt
  state.vz = (state.z - prevZ) / dt

  state.aim = input.aim
}
