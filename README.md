# ⚔️ BattleManiac

**Battle Royale 2.5D multijugador** con perspectiva isométrica, servidor autoritativo en Node.js y cliente Three.js. Hasta **8 jugadores** por sala, FFA y último en pie.

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Three.js](https://img.shields.io/badge/Three.js-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com)

---

## ✨ Características

- 🎮 **Multijugador en tiempo real** — salas de hasta 8 jugadores vía WebSocket.
- 🧠 **Servidor autoritativo** — el cliente solo envía inputs; el servidor valida y simula.
- 🔁 **Predicción y reconciliación** — movimiento local instantáneo con corrección del servidor.
- 🎯 **Combate con proyectiles** — 100 HP, daño por impacto, muerte y modo espectador.
- 🏆 **Partidas FFA** — último en pie, límite de 5 minutos y reinicio automático.
- 📱 **Soporte móvil y tablet** — doble stick táctil con auto-disparo y asistencia de puntería.
- 🗺️ **Mapa generado desde datos** — colisión 2D y altura analítica del terreno.
- 🧭 **HUD con minimapa** — jugadores vivos, orientación y estado de la partida.
- 🤖 **Bots headless** — pruebas de carga y relleno de salas sin navegador.
- 🐳 **Listo para Docker** — imagen multi-stage, healthcheck y despliegue con TLS.

## 🛠️ Stack

| Capa | Tecnología |
|---|---|
| Cliente | Three.js, TypeScript, Vite |
| Servidor | Node.js, `ws`, TypeScript (`tsx`) |
| Compartido | Protocolo, movimiento, colisión, mapa y RNG determinista |
| Pruebas | Simulación headless + bots |
| Infraestructura | Docker multi-stage, Docker Compose, Traefik / Caddy |

## 📋 Requisitos

- **Node.js 24+**
- **npm 11+**

## 🚀 Puesta en marcha

```bash
npm install
npm run dev
```

| Servicio | URL |
|---|---|
| Cliente | http://localhost:5173 |
| Servidor | http://localhost:8080 (`/health`) |
| WebSocket | `ws://localhost:8080/ws` (Vite lo proxya en desarrollo) |

Para servir el cliente compilado desde el propio servidor:

```bash
npm run build
npm start        # http://localhost:8080
```

## 🎮 Controles

| Acción | Control |
|---|---|
| Mover | `WASD` relativo al apuntado (`W` va hacia el cursor) |
| Apuntar | Ratón |
| Disparar | Clic izquierdo (mantener) |
| Zoom | Rueda |
| Mover (móvil) | Stick izquierdo (aparece donde tocas) |
| Apuntar y disparar (móvil) | Stick derecho; dispara al desviarlo |

Al morir pasas a espectador y la partida se reinicia automáticamente **8 segundos** después. La partida tiene un límite de **5 minutos**.

El HUD incluye un minimapa con los jugadores vivos: punto blanco para ti y el color de cada rival, con una línea que indica hacia dónde miran. El terreno usa una textura con rejilla cada 10 m para percibir el movimiento.

### Móvil y tablet

El cliente detecta punteros táctiles y muestra dos sticks virtuales dinámicos:

- **Izquierdo:** mueve en la dirección del dedo respecto a la pantalla.
- **Derecho:** apunta y dispara automáticamente al desviarlo, con asistencia de puntería suave y comprobación de línea de visión.

En táctil la cámara se abre más, el HUD se reorganiza y se reduce la resolución interna y la sombra para mantener el rendimiento. En vertical aparece un aviso para girar el dispositivo.

Para forzar un modo en escritorio: `?touch=1` o `?touch=0`.

Probar en un móvil de la misma red:

```bash
npm run dev:server
npm run dev -w @br/client -- --host
# abrir http://IP_DEL_PC:5173 en el móvil
```

## 📜 Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor + cliente en modo desarrollo |
| `npm run build` | Build de producción del cliente |
| `npm start` | Servidor sirviendo el build |
| `npm run bots -- --bots 8` | 8 bots headless en la sala `dev` |
| `npm run simtest` | Pruebas de simulación: movimiento, colisión, combate, reinicio y determinismo |
| `npm run typecheck` | TypeScript en todo el monorepo |

Opciones de bots: `--bots N`, `--room dev`, `--url ws://localhost:8080/ws`, `--skill easy|normal|hard`.

## 🏗️ Arquitectura

```
apps/client      Three.js + Vite. Render, input, predicción y reconciliación.
apps/server      Node + ws. Salas, tick autoritativo, combate, snapshots.
packages/shared  Protocolo, constantes, movimiento, colisión, mapa, RNG.
tools/bot        Cliente headless para pruebas de carga y relleno.
```

- Tick fijo de **30 Hz**; snapshots a **20 Hz**; interpolación con **100 ms** de retardo.
- El cliente envía **inputs**, nunca posiciones. El servidor es la única autoridad.
- Movimiento y colisión son código compartido: predicción y servidor ejecutan exactamente la misma función.
- Reconexión por token con **30 s** de gracia.
- Mapa `arena_01` generado desde datos: colisión 2D (círculos y polígonos) y altura analítica del terreno.

### Protocolo

```ts
// C→S
{ t: 'join',  room, name, token? }
{ t: 'input', seq, moveX, moveZ, aim, buttons }
{ t: 'ping',  id, clientTime }

// S→C
{ t: 'welcome', playerId, token, room, mapId, tickRate }
{ t: 'roster',  players[] }
{ t: 'snapshot', tick, ack, you, players[], bullets[], events[], phase, alive, timeLeft, serverTime }
{ t: 'pong',    id, clientTime, serverTime }
{ t: 'error',   code, message }
```

Validación en servidor: `|move| <= 1`, `aim` finito, `seq` monótono y máximo 40 inputs/s.

## 🧪 Pruebas

```bash
npm run simtest
npm run typecheck
```

`simtest` cubre movimiento, colisión contra edificios y paredes, daño por proyectil, muerte, fin de partida, reinicio y reproducibilidad de la simulación.

## 🐳 Despliegue con Docker

El `docker-compose.yml` incluido usa la imagen publicada en **GitHub Container Registry** y despliega el juego detrás de **Traefik**, con TLS gestionado por Let's Encrypt:

```
ghcr.io/mcardenasthorlund/battlemaniac:latest
```

```bash
docker compose up -d
```

Requisitos:

- Un dominio o subdominio apuntando a la IP del servidor.
- Puertos **80** y **443** abiertos.
- Una red externa de Traefik llamada `traefik-proxy`.

```bash
docker network create traefik-proxy   # solo si aún no existe
```

Ajusta el dominio en las etiquetas de `docker-compose.yml` antes de desplegar.

### Build local

```bash
docker build -t battlemaniac .
docker run -d --restart unless-stopped -p 8080:8080 --name battlemaniac battlemaniac
# http://IP_DEL_SERVIDOR:8080
```

También se incluye un `Caddyfile` como alternativa a Traefik: copia `.env.example` a `.env`, define `DOMAIN` y arranca Caddy delante del servicio `game` en el puerto `8080`.

### Notas de despliegue

- Las partidas viven en memoria: reiniciar el contenedor las reinicia.
- No hay autenticación; cualquiera con la URL puede entrar a una sala. Para un servidor privado, usa un código de sala no publicado.
- Logs y estado: `docker compose logs -f game` y `curl localhost/health`.
- No expongas el puerto `8080` directamente si usas un proxy inverso con TLS.
- Si usas Cloudflare, deja el registro en modo **DNS only** durante la emisión del certificado; después puedes activar el proxy (soporta WebSocket).

## 🗺️ Estado del proyecto

| Hito | Estado |
|---|---|
| M0 — Monorepo, TypeScript y scripts | ✅ Completado |
| M1 — Escena 3D, mapa, movimiento y oclusión | ✅ Completado |
| M2 — Servidor, salas, snapshots y predicción | ✅ Completado |
| M3 — Verificación de netcode y pruebas | ✅ Completado |
| M4 — Disparo, daño, muerte y espectador | ✅ Completado |
| M5 — Partida FFA, marcador y bots | ✅ Completado |
| M6 — Arte, animaciones y audio | ⏳ Pendiente |
| M7 — Endurecimiento y despliegue en producción | 🔄 En curso |

### Limitaciones conocidas del PoC

- Sin loot, inventario, zona que se cierra ni equipos.
- Sin compensación de latencia (rewind) para el registro de impactos.
- Los snapshots no se filtran por línea de visión (un cliente modificado vería posiciones a través de paredes).
- Assets geométricos de graybox, sin animaciones ni audio.

## 🤝 Contribuir

1. Haz un fork del repositorio.
2. Crea una rama: `git checkout -b feat/mi-mejora`.
3. Ejecuta `npm run typecheck` y `npm run simtest`.
4. Abre un Pull Request describiendo el cambio.

## 📄 Licencia

Distribuido bajo la licencia **MIT**. Consulta [LICENSE](LICENSE) para más información.

Los assets externos y sus licencias se documentan en [CREDITS.md](CREDITS.md).

---

Hecho con ❤️ y TypeScript por [Manuel Cárdenas Thorlund](https://github.com/mcardenasthorlund).
