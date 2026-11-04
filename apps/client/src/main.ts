import * as THREE from 'three'
import './style.css'
import {
  BUTTON_FIRE,
  DT,
  INTERP_DELAY_MS,
  MAX_HP,
  RECONCILE_SNAP_DISTANCE,
  TICK_HZ,
  buildWorld,
  clamp,
  getMap,
  normalizeAngle,
  angleDiff,
  pointBlocked,
  stepMovement,
  terrainHeight,
  type BulletSnapshot,
  type GameEvent,
  type MatchPhase,
  type PlayerInfo,
  type PlayerInput,
  type PlayerSnapshot,
  type PropDef,
  type SnapshotMessage,
} from '@br/shared'
import { GameConnection } from './net/gameConnection'
import { SnapshotBuffer } from './net/snapshotBuffer'
import { InputManager } from './game/input'
import { PinchZoom } from './game/pinchZoom'
import { buildWorldView, setFaded } from './render/worldView'
import { PlayerView } from './render/playerView'
import { Effects } from './render/effects'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Elemento #${id} no encontrado`)
  return node as T
}

// ---------------------------------------------------------------- DOM

const appEl = el<HTMLDivElement>('app')
const hudEl = el<HTMLDivElement>('hud')
const menuEl = el<HTMLDivElement>('menu')
const statusEl = el<HTMLDivElement>('status')
const hpFillEl = el<HTMLDivElement>('hp-fill')
const hpTextEl = el<HTMLSpanElement>('hp-text')
const aliveEl = el<HTMLSpanElement>('alive')
const phaseEl = el<HTMLDivElement>('phase')
const matchTimerEl = el<HTMLDivElement>('match-timer')
const pingEl = el<HTMLDivElement>('ping')
const fpsEl = el<HTMLDivElement>('fps')
const debugEl = el<HTMLDivElement>('debug')
const feedEl = el<HTMLDivElement>('feed')
const deathEl = el<HTMLDivElement>('death')
const deathSubEl = el<HTMLDivElement>('death-sub')
const nameEl = el<HTMLDivElement>('player-name')
const minimapCanvas = el<HTMLCanvasElement>('minimap')
const damageFlashEl = el<HTMLDivElement>('damage-flash')
const menuErrorEl = el<HTMLDivElement>('menu-error')
const formEl = el<HTMLFormElement>('join-form')
const nameInputEl = el<HTMLInputElement>('name-input')
const roomInputEl = el<HTMLInputElement>('room-input')
const touchControlsEl = el<HTMLDivElement>('touch-controls')
const leftStickZoneEl = el<HTMLDivElement>('stick-left')
const rightStickZoneEl = el<HTMLDivElement>('stick-right')
const rotateHintEl = el<HTMLDivElement>('rotate-hint')
const viewControlsEl = el<HTMLDivElement>('view-controls')
const fullscreenBtn = el<HTMLButtonElement>('fullscreen-btn')

// ---------------------------------------------------------------- Three

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.25
appEl.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0f14)
scene.fog = new THREE.Fog(0x0b0f14, 70, 170)

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400)
const MIN_VIEW_HEIGHT = 14
const MAX_VIEW_HEIGHT = 34
let viewHeight = 22

function updateFrustum(): void {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight)
  camera.left = (-viewHeight * aspect) / 2
  camera.right = (viewHeight * aspect) / 2
  camera.top = viewHeight / 2
  camera.bottom = -viewHeight / 2
  camera.updateProjectionMatrix()
}
updateFrustum()

const hemi = new THREE.HemisphereLight(0x9cc0e8, 0x3a3125, 1.15)
scene.add(hemi)

const sun = new THREE.DirectionalLight(0xffe2b8, 2.9)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -38
sun.shadow.camera.right = 38
sun.shadow.camera.top = 38
sun.shadow.camera.bottom = -38
sun.shadow.camera.near = 1
sun.shadow.camera.far = 140
sun.shadow.bias = -0.0008
sun.shadow.camera.updateProjectionMatrix()
scene.add(sun)
scene.add(sun.target)

const map = getMap('arena_01')
const world = buildWorld(map)
const worldView = buildWorldView(map, scene)
const effects = new Effects(scene)

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 900),
  new THREE.MeshStandardMaterial({ color: 0x10150f, roughness: 1 }),
)
backdrop.rotation.x = -Math.PI / 2
backdrop.position.set(map.width / 2, -0.8, map.depth / 2)
scene.add(backdrop)

// ---------------------------------------------------------------- Minimapa

const minimapCtx = minimapCanvas.getContext('2d')
if (!minimapCtx) throw new Error('Canvas 2D no disponible para el minimapa')

const MINIMAP_PAD = 12
const minimapScale =
  (minimapCanvas.width - MINIMAP_PAD * 2) / Math.max(map.width, map.depth)
const minimapBase = document.createElement('canvas')
minimapBase.width = minimapCanvas.width
minimapBase.height = minimapCanvas.height

function buildMinimapBase(): void {
  const ctx = minimapBase.getContext('2d')
  if (!ctx) return

  const width = minimapBase.width
  const height = minimapBase.height

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(8, 13, 10, 0.92)'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#2b3723'
  ctx.fillRect(
    MINIMAP_PAD,
    MINIMAP_PAD,
    map.width * minimapScale,
    map.depth * minimapScale,
  )

  if (map.lake) {
    ctx.fillStyle = '#2f7f9e'
    for (const lobe of map.lake.lobes) {
      ctx.beginPath()
      lobe.outline.forEach((point, index) => {
        const x = MINIMAP_PAD + point.x * minimapScale
        const y = MINIMAP_PAD + point.z * minimapScale
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fill()
    }

    const bridge = map.lake.bridge
    ctx.fillStyle = '#8a6a3f'
    ctx.fillRect(
      MINIMAP_PAD + (bridge.x - bridge.w / 2) * minimapScale,
      MINIMAP_PAD + (bridge.z - bridge.d / 2) * minimapScale,
      bridge.w * minimapScale,
      bridge.d * minimapScale,
    )
  }

  const colors: Record<PropDef['kind'], string> = {
    house: '#8c8577',
    tower: '#a09a8c',
    wall: '#7d7a70',
    crate: '#9a7b4f',
    tree: '#3f6b3a',
    rock: '#6b6f73',
  }

  for (const prop of map.props) {
    const x = MINIMAP_PAD + prop.x * minimapScale
    const y = MINIMAP_PAD + prop.z * minimapScale
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(prop.rot)
    ctx.fillStyle = colors[prop.kind]

    if (prop.kind === 'tree' || prop.kind === 'rock') {
      const radius = Math.max(1.4, prop.r * minimapScale * 1.7)
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(
        (-prop.w * minimapScale) / 2,
        (-prop.d * minimapScale) / 2,
        prop.w * minimapScale,
        prop.d * minimapScale,
      )
    }
    ctx.restore()
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 2
  ctx.strokeRect(
    MINIMAP_PAD,
    MINIMAP_PAD,
    map.width * minimapScale,
    map.depth * minimapScale,
  )

  ctx.fillStyle = 'rgba(232, 238, 247, 0.6)'
  ctx.font = 'bold 17px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', width / 2, MINIMAP_PAD + 18)
}

buildMinimapBase()

const aimRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.36, 20),
  new THREE.MeshBasicMaterial({
    color: 0x9fd0ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }),
)
aimRing.rotation.x = -Math.PI / 2
aimRing.visible = false
scene.add(aimRing)

const bulletGeometry = new THREE.SphereGeometry(0.12, 8, 6)
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a })
const bulletViews = new Map<number, THREE.Mesh>()

// ---------------------------------------------------------------- Estado

interface LocalState {
  x: number
  z: number
  vx: number
  vz: number
  aim: number
  hp: number
  alive: boolean
}

const snapshots = new SnapshotBuffer()

const touchParam = new URLSearchParams(location.search).get('touch')
const initialTouchMode =
  touchParam === '1'
    ? true
    : touchParam === '0'
      ? false
      : window.matchMedia('(pointer: coarse)').matches

const input = new InputManager(
  camera,
  renderer.domElement,
  { leftZone: leftStickZoneEl, rightZone: rightStickZoneEl },
  initialTouchMode,
)
input.onModeChange = (isTouch) => applyInputMode(isTouch)

const pinchZoom = new PinchZoom({
  getViewHeight: () => viewHeight,
  setViewHeight: (value) => {
    viewHeight = value
    updateFrustum()
  },
  onActiveChange: (active) => input.setTouchSuspended(active),
  minViewHeight: MIN_VIEW_HEIGHT,
  maxViewHeight: MAX_VIEW_HEIGHT,
})

const roster = new Map<number, PlayerInfo>()
const playerViews = new Map<number, PlayerView>()
const fadedOccluders = new Set<THREE.Object3D>()

let myId = -1
let joined = false
let started = false
let desiredName = 'Jugador'
let desiredRoom = 'dev'
let token: string | undefined = localStorage.getItem('br-token') ?? undefined
let reconnectTimer: number | null = null

let local: LocalState | null = null
let localView: PlayerView | null = null
// Posición del jugador interpolada entre ticks fijos para que el render
// (60/120 Hz) no muestre el salto de la simulación (30 Hz).
let localPrevX = 0
let localPrevZ = 0
let localCurX = 0
let localCurZ = 0
let localRenderX = 0
let localRenderZ = 0
let pendingInputs: PlayerInput[] = []
let inputSeq = 0
let nextLocalShotAt = 0
let latestSnapshot: SnapshotMessage | null = null
let phase: MatchPhase = 'live'
let aliveCount = 0
let timeLeft = 0
let renderClock = 0
let renderClockReady = false
const correction = new THREE.Vector2()

function resetLocalRenderPose(): void {
  if (!local) return
  localPrevX = local.x
  localPrevZ = local.z
  localCurX = local.x
  localCurZ = local.z
  localRenderX = local.x
  localRenderZ = local.z
}

const CAMERA_OFFSET = new THREE.Vector3(34, 48, 34)
const camFocus = new THREE.Vector3(map.width / 2, 1, map.depth / 2)
camera.position.copy(camFocus).add(CAMERA_OFFSET)
camera.lookAt(camFocus)

const occlusionRay = new THREE.Raycaster()
const tmpFocus = new THREE.Vector3()
const tmpTarget = new THREE.Vector3()
const tmpDir = new THREE.Vector3()

// ---------------------------------------------------------------- Red

const conn = new GameConnection({
  onOpen: () => {
    if (started) joinNow()
  },
  onWelcome: (msg) => {
    joined = true
    myId = msg.playerId
    token = msg.token
    localStorage.setItem('br-token', token)
    menuEl.classList.add('hidden')
    hudEl.classList.remove('hidden')
    statusEl.classList.add('hidden')
    menuErrorEl.classList.add('hidden')
    nameEl.textContent = desiredName
    snapshots.clear()
    renderClockReady = false
    pendingInputs = []
    local = null
    correction.set(0, 0)
    updateTouchUi()
  },
  onRoster: (msg) => {
    roster.clear()
    for (const player of msg.players) roster.set(player.id, player)
  },
  onSnapshot: handleSnapshot,
  onServerError: (code, message) => {
    if (code === 'room_full') {
      started = false
      joined = false
      hudEl.classList.add('hidden')
      menuEl.classList.remove('hidden')
      menuErrorEl.textContent = message
      menuErrorEl.classList.remove('hidden')
      return
    }
    showStatus(message)
  },
  onClose: () => {
    if (!started) return
    joined = false
    updateTouchUi()
    showStatus('Conexión perdida. Reconectando…')
    scheduleReconnect()
  },
})

function joinNow(): void {
  conn.send({ t: 'join', room: desiredRoom, name: desiredName, token })
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    conn.connect()
  }, 1500)
}

let statusTimer: number | null = null
function showStatus(text: string): void {
  statusEl.textContent = text
  statusEl.classList.remove('hidden')
  if (statusTimer !== null) window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => statusEl.classList.add('hidden'), 3500)
}

function nameOf(id: number): string {
  return roster.get(id)?.name ?? `#${id}`
}

function handleSnapshot(msg: SnapshotMessage): void {
  latestSnapshot = msg
  snapshots.push(msg)
  phase = msg.phase
  aliveCount = msg.alive
  timeLeft = msg.timeLeft

  // Tras una recarga o reconexión el servidor puede tener un ack mayor que
  // nuestro contador: hay que saltar por encima o ignoraría todos los inputs.
  if (msg.ack > inputSeq) inputSeq = msg.ack

  const you = msg.you

  if (!local || you.id !== myId) {
    local = {
      x: you.x,
      z: you.z,
      vx: you.vx,
      vz: you.vz,
      aim: Math.atan2(map.depth / 2 - you.z, map.width / 2 - you.x),
      hp: you.hp,
      alive: you.alive,
    }
    correction.set(0, 0)
    resetLocalRenderPose()
    camFocus.set(you.x, terrainHeight(you.x, you.z) + 1.1, you.z)
  } else {
    reconcile(you, msg.ack)
  }

  for (const event of msg.events) handleEvent(event)
}

function reconcile(you: PlayerSnapshot, ack: number): void {
  if (!local) return

  const beforeX = local.x
  const beforeZ = local.z

  local.x = you.x
  local.z = you.z
  local.vx = you.vx
  local.vz = you.vz
  local.aim = you.aim
  local.hp = you.hp
  local.alive = you.alive

  pendingInputs = pendingInputs.filter((entry) => entry.seq > ack)

  if (!local.alive) {
    pendingInputs.length = 0
  } else {
    for (const entry of pendingInputs) stepMovement(local, entry, world, DT)
  }

  const errorX = beforeX - local.x
  const errorZ = beforeZ - local.z
  const error = Math.hypot(errorX, errorZ)

  if (error <= RECONCILE_SNAP_DISTANCE) {
    correction.x += errorX
    correction.y += errorZ
    correction.x = clamp(correction.x, -1.5, 1.5)
    correction.y = clamp(correction.y, -1.5, 1.5)
  } else {
    correction.set(0, 0)
  }

  // Desplaza también los extremos de la interpolación para que el render no
  // pierda la fase entre ticks al recibir un snapshot. La corrección compensa
  // el salto visual, así que la posición en pantalla sigue siendo continua.
  const deltaX = local.x - localCurX
  const deltaZ = local.z - localCurZ
  localPrevX += deltaX
  localPrevZ += deltaZ
  localCurX = local.x
  localCurZ = local.z
}

function handleEvent(event: GameEvent): void {
  switch (event.k) {
    case 'shot':
      if (event.by === myId) break // el trazador propio se predice localmente
      effects.addTracer(
        event.x,
        event.z,
        event.dx,
        event.dz,
        roster.get(event.by)?.color ?? '#ffffff',
      )
      break
    case 'hit':
      effects.addImpact(event.x, event.z)
      if (event.target === myId) flashDamage()
      break
    case 'kill':
      addFeed(`${nameOf(event.by)} eliminó a ${nameOf(event.target)}`)
      break
    case 'restart':
      addFeed('Nueva partida')
      break
  }
}

function flashDamage(): void {
  damageFlashEl.classList.add('active')
  window.setTimeout(() => damageFlashEl.classList.remove('active'), 70)
}

let feedCount = 0
function addFeed(text: string): void {
  const item = document.createElement('div')
  item.className = 'feed-item'
  item.textContent = text
  feedEl.prepend(item)
  feedCount++
  if (feedCount > 5) {
    feedEl.lastElementChild?.remove()
    feedCount = 5
  }
  window.setTimeout(() => {
    item.remove()
    feedCount = Math.max(0, feedCount - 1)
  }, 6000)
}

// ---------------------------------------------------------------- Modo de entrada

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
  msFullscreenElement?: Element | null
  msExitFullscreen?: () => Promise<void> | void
}

type FullscreenTarget = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

const fullscreenDocument = document as FullscreenDocument
const fullscreenTarget = document.documentElement as FullscreenTarget

function currentFullscreenElement(): Element | null {
  return (
    fullscreenDocument.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    fullscreenDocument.msFullscreenElement ??
    null
  )
}

function fullscreenSupported(): boolean {
  return Boolean(
    document.fullscreenEnabled ||
      fullscreenTarget.requestFullscreen ||
      fullscreenTarget.webkitRequestFullscreen ||
      fullscreenTarget.msRequestFullscreen,
  )
}

function updateFullscreenButton(): void {
  const active = currentFullscreenElement() !== null
  document.body.classList.toggle('fullscreen', active)
  fullscreenBtn.textContent = active ? '🗗' : '⛶'
  const label = active ? 'Salir de pantalla completa' : 'Pantalla completa'
  fullscreenBtn.title = label
  fullscreenBtn.setAttribute('aria-label', label)
  fullscreenBtn.setAttribute('aria-pressed', String(active))
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (currentFullscreenElement() !== null) {
      if (document.exitFullscreen) await document.exitFullscreen()
      else if (fullscreenDocument.webkitExitFullscreen)
        await fullscreenDocument.webkitExitFullscreen()
      else if (fullscreenDocument.msExitFullscreen) await fullscreenDocument.msExitFullscreen()
      return
    }

    if (fullscreenTarget.requestFullscreen) {
      await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' })
    } else if (fullscreenTarget.webkitRequestFullscreen) {
      await fullscreenTarget.webkitRequestFullscreen()
    } else if (fullscreenTarget.msRequestFullscreen) {
      await fullscreenTarget.msRequestFullscreen()
    } else {
      showStatus('Pantalla completa no disponible en este navegador')
    }
  } catch {
    showStatus('No se pudo activar la pantalla completa')
  }
}

function updateViewControls(): void {
  const available = input.isTouch && fullscreenSupported()
  viewControlsEl.classList.toggle('hidden', !available)
}

function updateTouchUi(): void {
  const active = joined && input.isTouch
  touchControlsEl.classList.toggle('hidden', !active)

  const portrait = window.innerHeight > window.innerWidth
  rotateHintEl.classList.toggle('hidden', !(active && portrait))
}

function applyInputMode(isTouch: boolean): void {
  document.body.classList.toggle('touch-mode', isTouch)

  viewHeight = isTouch ? 30 : 22
  updateFrustum()

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.25 : 1.5))
  renderer.setSize(window.innerWidth, window.innerHeight)

  const shadowSize = isTouch ? 1024 : 2048
  if (sun.shadow.mapSize.x !== shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize)
    sun.shadow.map?.dispose()
    sun.shadow.map = null
  }

  updateTouchUi()
  updateViewControls()
}

/** Asistencia de puntería suave para táctil: acerca el ángulo a un enemigo en cono. */
function applyAimAssist(aim: number, self: LocalState): number {
  if (!latestSnapshot) return aim

  let bestAngle = aim
  let bestScore = Number.POSITIVE_INFINITY

  for (const player of latestSnapshot.players) {
    if (!player.alive || player.id === myId) continue

    const dx = player.x - self.x
    const dz = player.z - self.z
    const distance = Math.hypot(dx, dz)
    if (distance > 24 || distance < 0.5) continue

    const target = Math.atan2(dz, dx)
    const diff = Math.abs(angleDiff(aim, target))
    if (diff > 0.19) continue
    if (!hasLineOfSight(self.x, self.z, player.x, player.z)) continue

    const score = diff + distance * 0.002
    if (score < bestScore) {
      bestScore = score
      bestAngle = target
    }
  }

  if (bestAngle === aim) return aim
  return normalizeAngle(aim + angleDiff(aim, bestAngle) * 0.6)
}

function hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax
  const dz = bz - az
  const distance = Math.hypot(dx, dz)
  const steps = Math.max(1, Math.ceil(distance / 1.5))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (pointBlocked(world, ax + dx * t, az + dz * t, 1.2)) return false
  }
  return true
}

// ---------------------------------------------------------------- Simulación local

function fixedUpdate(dt: number): void {
  if (!joined || !local) return

  const groundY = terrainHeight(local.x, local.z)
  const intent = input.getIntent({
    x: local.x,
    z: local.z,
    groundY,
    aim: local.aim,
    alive: local.alive,
  })

  let aimAngle = intent.aim
  if (input.isTouch && intent.fire) aimAngle = applyAimAssist(aimAngle, local)

  const buttons = intent.fire && local.alive ? BUTTON_FIRE : 0

  const seq = ++inputSeq
  const message: PlayerInput = {
    seq,
    moveX: intent.moveX,
    moveZ: intent.moveZ,
    aim: aimAngle,
    buttons,
  }

  pendingInputs.push(message)
  if (pendingInputs.length > 150) pendingInputs.splice(0, pendingInputs.length - 150)

  localPrevX = localCurX
  localPrevZ = localCurZ
  if (local.alive) stepMovement(local, message, world, dt)
  localCurX = local.x
  localCurZ = local.z

  if (
    local.alive &&
    (buttons & BUTTON_FIRE) !== 0 &&
    performance.now() >= nextLocalShotAt
  ) {
    nextLocalShotAt = performance.now() + 150
    const dx = Math.cos(aimAngle)
    const dz = Math.sin(aimAngle)
    effects.addTracer(
      local.x + dx * 0.6,
      local.z + dz * 0.6,
      dx,
      dz,
      roster.get(myId)?.color ?? '#4ea1ff',
    )
  }

  conn.send({ t: 'input', ...message })
}

// ---------------------------------------------------------------- Render

function pickSpectator(): PlayerSnapshot | null {
  if (!latestSnapshot) return null
  for (const player of latestSnapshot.players) {
    if (player.alive && player.id !== myId) return player
  }
  return null
}

function syncPlayers(players: Map<number, PlayerSnapshot>): void {
  const seen = new Set<number>()

  for (const [id, player] of players) {
    if (id === myId) continue
    seen.add(id)

    if (!player.alive) {
      playerViews.get(id)?.setState(player.x, player.z, player.aim, false)
      continue
    }

    let view = playerViews.get(id)
    if (!view) {
      view = new PlayerView(roster.get(id)?.color ?? '#ffffff', false)
      scene.add(view.group)
      playerViews.set(id, view)
    }
    view.setState(player.x, player.z, player.aim, true)
  }

  for (const [id, view] of playerViews) {
    if (seen.has(id)) continue
    scene.remove(view.group)
    view.dispose()
    playerViews.delete(id)
  }
}

function syncBullets(bullets: Map<number, BulletSnapshot>): void {
  const seen = new Set<number>()

  for (const [id, bullet] of bullets) {
    seen.add(id)
    let mesh = bulletViews.get(id)
    if (!mesh) {
      mesh = new THREE.Mesh(bulletGeometry, bulletMaterial)
      scene.add(mesh)
      bulletViews.set(id, mesh)
    }
    mesh.position.set(bullet.x, terrainHeight(bullet.x, bullet.z) + 1.2, bullet.z)
  }

  for (const [id, mesh] of bulletViews) {
    if (seen.has(id)) continue
    scene.remove(mesh)
    bulletViews.delete(id)
  }
}

function updateOcclusion(target: THREE.Vector3): void {
  tmpDir.copy(target).sub(camera.position)
  const distance = tmpDir.length()
  if (distance < 0.01) return
  tmpDir.normalize()

  occlusionRay.set(camera.position, tmpDir)
  occlusionRay.far = distance - 0.5
  const hits = occlusionRay.intersectObjects(worldView.occluders, true)

  const next = new Set<THREE.Object3D>()
  for (const hit of hits) {
    let root: THREE.Object3D | null = hit.object
    while (root && !root.userData.propRoot) root = root.parent
    if (root) next.add(root)
  }

  for (const object of fadedOccluders) {
    if (!next.has(object)) setFaded(object, false)
  }
  for (const object of next) {
    if (!fadedOccluders.has(object)) setFaded(object, true)
  }

  fadedOccluders.clear()
  for (const object of next) fadedOccluders.add(object)
}

let minimapAccum = 0

function updateMinimap(dt: number): void {
  minimapAccum += dt
  if (minimapAccum < 0.1) return
  minimapAccum = 0

  const ctx = minimapCtx!
  ctx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height)
  ctx.drawImage(minimapBase, 0, 0)

  const players = latestSnapshot?.players
  if (!players) return

  for (const player of players) {
    if (!player.alive) continue

    const isLocal = player.id === myId
    const x = MINIMAP_PAD + (isLocal && local ? localRenderX : player.x) * minimapScale
    const y = MINIMAP_PAD + (isLocal && local ? localRenderZ : player.z) * minimapScale
    const aim = isLocal && local ? local.aim : player.aim

    const radius = isLocal ? 6.5 : 5.5
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = isLocal ? '#ffffff' : (roster.get(player.id)?.color ?? '#ff6b6b')
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(aim) * 12, y + Math.sin(aim) * 12)
    ctx.strokeStyle = isLocal ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = isLocal ? 2.5 : 1.5
    ctx.stroke()
  }
}

function updateHud(): void {
  if (local) {
    const hp = clamp(Math.max(0, Math.round(local.hp)), 0, MAX_HP)
    hpTextEl.textContent = String(hp)
    hpFillEl.style.width = `${hp}%`
    hpFillEl.classList.toggle('low', hp <= 35)
  }

  aliveEl.textContent = String(aliveCount)
  phaseEl.textContent = phase === 'over' ? 'Partida terminada' : 'En partida'

  if (phase === 'over') {
    matchTimerEl.textContent = `Reinicio en ${timeLeft.toFixed(1)} s`
  } else {
    const minutes = Math.floor(timeLeft / 60)
    const seconds = Math.floor(timeLeft % 60)
    matchTimerEl.textContent = `Tiempo ${minutes}:${seconds.toString().padStart(2, '0')}`
  }
  pingEl.textContent = `ping ${conn.latency.toFixed(0)} ms`
  debugEl.textContent = `tick ${latestSnapshot?.tick ?? 0} · ack ${latestSnapshot?.ack ?? 0}`

  const dead = local !== null && !local.alive
  deathEl.classList.toggle('hidden', !dead)
  if (dead) {
    deathSubEl.textContent =
      phase === 'over' ? `Reinicio en ${timeLeft.toFixed(1)} s` : 'Observando la partida…'
  }
}

let fps = 0
let fpsTime = 0
let fpsFrames = 0

function renderFrame(dt: number): void {
  const renderAlpha = clamp(accumulator / DT, 0, 1)
  localRenderX = localPrevX + (localCurX - localPrevX) * renderAlpha
  localRenderZ = localPrevZ + (localCurZ - localPrevZ) * renderAlpha

  let focusX = map.width / 2
  let focusZ = map.depth / 2

  if (local) {
    focusX = localRenderX
    focusZ = localRenderZ
    if (!local.alive) {
      const spectator = pickSpectator()
      if (spectator) {
        focusX = spectator.x
        focusZ = spectator.z
      }
    }
  }

  const groundY = terrainHeight(focusX, focusZ)

  // En escritorio el objetivo es el cursor; en táctil, un punto fijo en la
  // dirección de apuntado (no hay cursor).
  let aimX = focusX
  let aimZ = focusZ
  if (input.isTouch) {
    const baseX = local ? localRenderX : focusX
    const baseZ = local ? localRenderZ : focusZ
    const angle = local ? local.aim : 0
    aimX = baseX + Math.cos(angle) * 7
    aimZ = baseZ + Math.sin(angle) * 7
  } else {
    const point = input.keyboard.aimPoint(groundY)
    aimX = point.x
    aimZ = point.z
  }

  if (local && local.alive) {
    const strength = input.isTouch ? 0.18 : 0.25
    const maxOffset = input.isTouch ? 2 : 4
    focusX += clamp((aimX - localRenderX) * strength, -maxOffset, maxOffset)
    focusZ += clamp((aimZ - localRenderZ) * strength, -maxOffset, maxOffset)
  }

  tmpFocus.set(focusX, terrainHeight(focusX, focusZ) + 1.1, focusZ)
  camFocus.lerp(tmpFocus, 1 - Math.exp(-10 * dt))

  camera.position.copy(camFocus).add(CAMERA_OFFSET)
  camera.lookAt(camFocus)

  sun.position.set(camFocus.x + 28, 52, camFocus.z + 18)
  sun.target.position.set(camFocus.x, 0, camFocus.z)
  sun.target.updateMatrixWorld()

  if (local) {
    if (!localView) {
      localView = new PlayerView(roster.get(myId)?.color ?? '#4ea1ff', true)
      scene.add(localView.group)
    }
    localView.setState(
      localRenderX + correction.x,
      localRenderZ + correction.y,
      local.aim,
      local.alive,
    )
  }

  const latest = snapshots.latest
  if (latest) {
    if (!renderClockReady) {
      renderClock = latest.tick - (INTERP_DELAY_MS / 1000) * TICK_HZ
      renderClockReady = true
    }
    renderClock += dt * TICK_HZ
    const target = latest.tick - (INTERP_DELAY_MS / 1000) * TICK_HZ
    if (Math.abs(target - renderClock) > 6) {
      renderClock = target
    } else {
      renderClock += (target - renderClock) * Math.min(1, dt * 3)
    }

    const sampled = snapshots.sample(renderClock)
    syncPlayers(sampled.players)
    syncBullets(sampled.bullets)
  }

  correction.multiplyScalar(Math.exp(-12 * dt))

  if (local && local.alive) {
    aimRing.visible = true
    aimRing.position.set(aimX, terrainHeight(aimX, aimZ) + 0.06, aimZ)
  } else {
    aimRing.visible = false
  }

  effects.update(dt)
  updateOcclusion(camFocus)
  updateHud()
  updateMinimap(dt)
  renderer.render(scene, camera)
}

// ---------------------------------------------------------------- Bucle

let lastTime = performance.now()
let accumulator = 0

function frame(now: number): void {
  requestAnimationFrame(frame)

  let dt = (now - lastTime) / 1000
  lastTime = now
  if (!Number.isFinite(dt) || dt < 0) dt = 0
  dt = Math.min(dt, 0.25)

  fpsTime += dt
  fpsFrames++
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime
    fpsTime = 0
    fpsFrames = 0
    fpsEl.textContent = `fps ${fps.toFixed(0)}`
  }

  accumulator += dt
  let steps = 0
  while (accumulator >= DT && steps < 8) {
    fixedUpdate(DT)
    accumulator -= DT
    steps++
  }
  if (steps >= 8) accumulator = 0

  renderFrame(dt)
}

// ---------------------------------------------------------------- Entrada de UI

formEl.addEventListener('submit', (event) => {
  event.preventDefault()
  desiredName = nameInputEl.value.trim() || 'Jugador'
  desiredRoom = roomInputEl.value.trim() || 'dev'
  menuErrorEl.classList.add('hidden')
  started = true
  menuEl.classList.add('hidden')
  showStatus('Conectando…')

  if (conn.connected) joinNow()
  else conn.connect()
})

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  updateFrustum()
  updateTouchUi()
})

window.addEventListener(
  'wheel',
  (event) => {
    viewHeight = clamp(
      viewHeight + Math.sign(event.deltaY) * 2,
      MIN_VIEW_HEIGHT,
      MAX_VIEW_HEIGHT,
    )
    updateFrustum()
  },
  { passive: true },
)

fullscreenBtn.addEventListener('click', () => {
  void toggleFullscreen()
})
document.addEventListener('fullscreenchange', updateFullscreenButton)
document.addEventListener('webkitfullscreenchange', updateFullscreenButton)
document.addEventListener('msfullscreenchange', updateFullscreenButton)
updateFullscreenButton()

// ---------------------------------------------------------------- API de depuración

if (import.meta.env.DEV) {
  ;(window as unknown as { __br: unknown }).__br = {
    renderer,
    scene,
    camera,
    state: () => ({
      joined,
      myId,
      local: local ? { ...local } : null,
      render: local
        ? { x: localRenderX, z: localRenderZ, correctionX: correction.x, correctionZ: correction.y }
        : null,
      phase,
      aliveCount,
      tick: latestSnapshot?.tick ?? 0,
      ack: latestSnapshot?.ack ?? 0,
      players: latestSnapshot?.players.length ?? 0,
      bullets: latestSnapshot?.bullets.length ?? 0,
      ping: conn.latency,
      firing: input.firing,
      touch: input.isTouch,
      zoom: viewHeight,
      pinching: pinchZoom.isActive,
      fullscreen: currentFullscreenElement() !== null,
    }),
    snapshot: () => latestSnapshot,
    step: (frames = 1): number => {
      for (let i = 0; i < frames; i++) {
        fixedUpdate(DT)
        renderFrame(DT)
      }
      return latestSnapshot?.tick ?? 0
    },
    capture: (width = 960, height = 540): string => {
      renderer.render(scene, camera)
      const source = renderer.domElement
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return ''
      context.drawImage(source, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', 0.72)
    },
  }
}

applyInputMode(initialTouchMode)

requestAnimationFrame(frame)
