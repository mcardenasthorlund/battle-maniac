# Battle Royale 2.5D — Plan de ejecución

PoC multijugador (hasta 8 jugadores) con perspectiva isométrica 3D, servidor autoritativo en Node.js.

## Decisiones cerradas

| Tema | Decisión |
|---|---|
| Render | Three.js + `OrthographicCamera`, pitch 45°, yaw 45° con snap opcional a 90° |
| Netcode | Propio con `ws`; JSON en dev, encoder binario tras medir |
| Autoridad | Servidor autoritativo; predicción + reconciliación en el jugador local; interpolación para el resto |
| Simulación | Tick fijo de 30 Hz; snapshots a 20 Hz; render con 100 ms de retardo |
| Alcance PoC | 1 mapa, 1 arma de proyectiles, 100 HP, FFA, último en pie |
| Testeo | Bots headless en local; despliegue posterior en VPS |
| Arte | Packs gratuitos low-poly (KayKit, Quaternius, Kenney) + Mixamo |

## Estructura del monorepo

```
/apps/client
  src/main.ts
  src/net/{gameConnection,snapshotBuffer}.ts
  src/render/{worldView,playerView,effects}.ts
  src/game/input.ts
/apps/server
  src/index.ts
  src/rooms/{room,roomManager}.ts
  src/net/validation.ts
/packages/shared
  src/{constants,protocol,math,collision,map,movement,index}.ts
/tools/bot
  src/index.ts
/CREDITS.md
```

`shared` no importa Three.js: lo usan cliente, servidor y bots por igual.

## Protocolo

```ts
// C→S
{ t:'join',  room:string, name:string, token?:string }
{ t:'input', seq:number, moveX:number, moveZ:number, aim:number, buttons:number }
{ t:'ping',  id:number, clientTime:number }

// S→C
{ t:'welcome', playerId:number, token:string, room:string, mapId:string, tickRate:number }
{ t:'roster',  players: { id:number, name:string, color:string }[] }
{ t:'snapshot', tick, ack, you, players[], bullets[], events[], phase, alive, timeLeft, serverTime }
{ t:'pong',    id, clientTime, serverTime }
{ t:'error',   code, message }
```

Validación en servidor: `|move| <= 1`, `aim` finito, `seq` monótono, máximo 40 inputs/s.

## Simulación

```ts
TICK_HZ = 30; SNAPSHOT_HZ = 20; INTERP_DELAY_MS = 100
PLAYER_RADIUS = 0.4; PLAYER_SPEED = 5.5; HP = 100
BULLET_SPEED = 30; DAMAGE = 25; FIRE_COOLDOWN = 0.15s
```

- Movimiento con aceleración, colisión círculo-vs-polígono/círculo y deslizamiento.
- Disparo: proyectil 3D horizontal a y=1.2 m; los muros con altura lo bloquean.
- RNG determinista con semilla en servidor.
- Un input procesado por tick y jugador (cola con límite).

## Cliente

- Predicción local + replay de inputs no confirmados (`ack` del servidor); snap si la corrección supera 2 m.
- Buffer de snapshots e interpolación a 100 ms de retardo para el resto del mundo.
- Oclusión: desvanecer edificios/árboles que tapan al jugador.
- Cámara ortográfica con deadzone, offset hacia el cursor y zoom.

## Servidor

- Un proceso: HTTP estático + `/health` + WebSocket en `/ws`.
- `RoomManager` con código de sala, capacidad 8, reconexión por token (gracia 30 s).
- Máquina de estados `live → over(8 s) → live`.
- Log de partida JSONL con entradas por tick para replay/determinismo.

## Bots

Cliente headless Node que importa `shared`: merodea, detecta enemigos a <14 m, apunta con error y dispara.
Flags: `--bots 8 --url ws://localhost:8080/ws --room dev --skill normal`.

## Hitos

- [x] **M0** Monorepo, TypeScript, scripts, CI local.
- [x] **M1** Escena 3D, cámara ortográfica, mapa gris, movimiento local con colisión y oclusión.
- [x] **M2** Servidor `ws`, salas, snapshots, interpolación, predicción/reconciliación.
- [x] **M4** Disparo, proyectiles, daño, muerte y espectador.
- [x] **M5** Partida FFA, marcador, bots headless.
- [x] **M3** Verificación de predicción/reconciliación y pruebas de simulación.
- [ ] **M6** Arte real, animaciones, audio posicional, postprocesado.
- [ ] **M7** Endurecimiento, Docker, despliegue VPS.

> Estado actual: M0-M5 implementados y verificados (`npm run simtest`, 8 bots
> conectados, render isométrico validado, textura de suelo, minimapa y doble
> stick táctil con auto-disparo). M7 tiene Dockerfile, Compose y Caddy listos,
> pendiente de probar en un VPS real. M6 no iniciado: el aspecto actual es
> graybox a propósito.

## Criterios de aceptación

- 8 clientes + 8 bots sin caídas en partidas de 15 min.
- Tick p95 < 3 ms; snapshot < 2 KB.
- 60 FPS en GPU integrada a 1080p.
- Con 100 ms de RTT simulado, correcciones locales < 0.3 m.
- Replay de un log de inputs reproducible (mismo hash de estado).

## Assets previstos (M6)

KayKit / Quaternius / Kenney (CC0), Mixamo, Poly Haven, Freesound. Todo con licencia en `CREDITS.md`.

## Entorno

- Node 24, npm 12, Windows.
- `npm install`, `npm run dev` (servidor 8080 + cliente 5173), `npm run bots`.
