# Battle Royale 2.5D — PoC

Prueba de concepto multijugador (hasta 8 jugadores) con perspectiva isométrica 3D,
servidor autoritativo en Node.js y cliente Three.js.

## Requisitos

- Node.js 24+
- npm 11+

## Puesta en marcha

```bash
npm install
npm run dev
```

- Cliente: http://localhost:5173
- Servidor: http://localhost:8080 (`/health`)
- WebSocket: `ws://localhost:8080/ws` (Vite lo proxya en desarrollo)

Para servir el cliente compilado desde el propio servidor:

```bash
npm run build
npm start        # http://localhost:8080
```

## Controles

| Acción | Control |
|---|---|
| Mover | `WASD` relativo al apuntado (`W` va hacia el cursor) |
| Apuntar | Ratón |
| Disparar | Clic izquierdo (mantener) |
| Zoom | Rueda |
| Mover (móvil) | Stick izquierdo (aparece donde tocas) |
| Apuntar y disparar (móvil) | Stick derecho; dispara automáticamente al desviarlo |

FFA, último en pie. Al morir pasas a espectador y la partida se reinicia
automáticamente 8 segundos después. La partida tiene un límite de 5 minutos.

El HUD incluye un minimapa en una esquina con los jugadores vivos: punto
blanco para ti y el color de cada rival, con una línea que indica hacia dónde
miran. El terreno tiene una textura con rejilla cada 10 m para percibir el
movimiento.

### Móvil y tablet

El cliente detecta punteros táctiles y muestra dos sticks virtuales dinámicos:

- **Izquierdo**: mueve en la dirección del dedo respecto a la pantalla.
- **Derecho**: apunta; al desviarlo dispara automáticamente. Incluye una
  asistencia de puntería suave con comprobación de línea de visión.

En táctil la cámara se abre más, el HUD se reorganiza y se reduce la resolución
interna y la sombra para mantener el rendimiento. En vertical aparece un aviso
para girar el dispositivo.

Para forzar un modo en escritorio: `?touch=1` o `?touch=0`.

Probar en un móvil de la misma red:

```bash
npm run dev:server
npm run dev -w @br/client -- --host
# abrir http://IP_DEL_PC:5173 en el móvil
```

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor + cliente en modo desarrollo |
| `npm run build` | Build de producción del cliente |
| `npm start` | Servidor sirviendo el build |
| `npm run bots -- --bots 8` | 8 bots headless en la sala `dev` |
| `npm run simtest` | Pruebas de simulación: movimiento, colisión, combate, reinicio y determinismo |
| `npm run typecheck` | TypeScript en todo el monorepo |

Opciones de bots: `--bots N`, `--room dev`, `--url ws://localhost:8080/ws`,
`--skill easy|normal|hard`.

## Arquitectura

```
apps/client      Three.js + Vite. Render, input, predicción y reconciliación.
apps/server      Node + ws. Salas, tick autoritativo, combate, snapshots.
packages/shared  Protocolo, constantes, movimiento, colisión, mapa, RNG.
tools/bot        Cliente headless para pruebas de carga y relleno.
```

- Tick fijo de **30 Hz**; snapshots a **20 Hz**; interpolación con **100 ms** de retardo.
- El cliente envía **inputs**, nunca posiciones. El servidor es la única autoridad.
- Movimiento y colisión son código compartido, de modo que predicción y servidor
  ejecutan exactamente la misma función.
- Reconexión por token con 30 s de gracia.
- Mapa `arena_01` generado desde datos: colisión 2D (círculos y polígonos) y
  altura analítica del terreno.

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

## Pruebas

```bash
npm run simtest
```

Cubre movimiento, colisión contra edificios y paredes, daño por proyectil, muerte,
fin de partida, reinicio y reproducibilidad de la simulación.

## Despliegue en VPS

Probado con Docker 29 y Docker Compose v5: la imagen compila, sirve el cliente,
responde `/health` y acepta conexiones WebSocket.

### 1. Requisitos

- VPS con Ubuntu 24.04 (1 vCPU / 2 GB basta para 8 jugadores).
- Un dominio o subdominio con registro **A** apuntando a la IP del VPS.
- Puertos **80** y **443** abiertos en el firewall del proveedor.

### 2. Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Subir el proyecto

```bash
# Opción A: git
git clone <tu-repositorio> /opt/battle-royale

# Opción B: desde tu máquina
scp -r . usuario@IP_DEL_VPS:/opt/battle-royale
```

### 4. Configurar el dominio

```bash
cd /opt/battle-royale
cp .env.example .env
nano .env        # DOMAIN=br.tudominio.com
```

### 5. Arrancar

```bash
docker compose up -d --build
docker compose logs -f caddy   # esperar a que emita el certificado
```

Abre `https://br.tudominio.com`. El cliente usará `wss://` automáticamente.

### 6. Firewall

```bash
sudo ufw allow 80,443/tcp
sudo ufw enable
```

No expongas el puerto `8080`: solo Caddy debe ser accesible desde fuera.

### Actualizar

```bash
git pull
docker compose up -d --build
```

### Sin dominio (solo pruebas)

```bash
docker build -t battle-royale .
docker run -d --restart unless-stopped -p 8080:8080 --name br battle-royale
```

Se accede por `http://IP_DEL_VPS:8080`. Sin TLS no hay `wss`, pero el cliente
detecta el protocolo y usa `ws`.

### Notas

- Las partidas viven en memoria: reiniciar el contenedor las reinicia.
- No hay autenticación; cualquiera con la URL puede entrar a una sala. Para un
  servidor privado, usa un código de sala no publicado.
- Logs y estado: `docker compose logs -f game` y `curl localhost/health` desde
  el propio VPS (o a través del dominio).
- Si usas Cloudflare, deja el registro en modo **DNS only** durante la emisión
  del certificado; luego puedes activar el proxy (soporta WebSocket).

## Estado

Implementado: M0–M5 (base, render isométrico, multijugador, predicción,
combate, partida FFA y bots). Pendiente: M6 (arte y audio definitivos) y M7
(endurecimiento y despliegue real).

Limitaciones conocidas del PoC:

- Sin loot, inventario, zona que se cierra ni equipos.
- Sin compensación de latencia (rewind) para el registro de impactos.
- Los snapshots no se filtran por línea de visión (un cliente modificado vería
  posiciones a través de paredes).
- Assets geométricos de graybox, sin animaciones ni audio.
