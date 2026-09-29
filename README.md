# Cita DEKRA Watcher

Vigila la disponibilidad de citas en DEKRA en varias ubicaciones (por defecto **Alajuela**
y **Puntarenas**) y te avisa por **Telegram** (gratis) o por **correo** (Resend) en cuanto
se libera una. Corre 100% en la nube: no necesitas tener tu computadora encendida.
**Se controla desde el mismo bot de Telegram**: `/buscar Alajuela` para empezar, `/parar` cuando ya reservaste.

### Como se usa desde Telegram

Al escribirle `/start` el bot muestra botones. El flujo es de dos pasos: **eliges estaciones**
(marcas hasta 3 y pulsas Siguiente) y luego **eliges hasta cuantos dias adelante** buscar
(1, 2, 3, 4, 5, 7, 10, 14 o solo la mas proxima; tambien puedes escribir el numero). Al elegir,
empieza. Lo mismo pasa con `/buscar Alajuela`: guarda la estacion y pregunta los dias.
Cada aviso de cita trae un boton **Reservar** por estacion y otro **"Ya reserve, parar busqueda"**.

| Comando | Efecto |
|---|---|
| `/menu` | botones para elegir estaciones, dias, empezar o parar |
| `/buscar Alajuela` | busca ahi (hasta 3: `/buscar Alajuela, Heredia, Cartago`; sirve sin tildes y a medias: `perez`) |
| `/buscar` | retoma la ultima busqueda (y renueva su expiracion) |
| `/parar` | pausa la busqueda (el cron sigue corriendo pero no consulta DEKRA) |
| `/estado` | activo o en pausa, estaciones, ventana, horario, silencio, expiracion, ultima revision y fallos |
| `/dias 5` | vigila de hoy a +5 dias (`/dias 0` = cita mas proxima; sin numero muestra botones) |
| `/horario 6-10` | solo avisa de cupos entre esas horas (`/horario todo` lo quita) |
| `/silencio 22-6` | no avisa en ese rango; lo acumulado llega al terminar (`/silencio no`) |
| `/ubicaciones` | botones de estaciones |
| `/ayuda` | lista de comandos |

Solo obedece a los chats de `TELEGRAM_CHAT_ID`. Los cambios aplican en la siguiente corrida (1 minuto).
Arranca **en pausa**: no consulta nada hasta que elijas estaciones y pulses Empezar.

### Lo que hace solo

- **Se apaga a los 14 dias** (`EXPIRE_DAYS`) y te avisa un dia antes, para que no se quede
  consultando DEKRA por meses si olvidas pararlo. `/buscar` lo renueva.
- **Latido diario** a las 7 am (`HEARTBEAT_HOUR`, `-1` lo apaga): "Sigo buscando en...".
- **Avisa si DEKRA deja de responder** tras 5 revisiones seguidas con error (`FAIL_ALERT_THRESHOLD`),
  y otra vez cuando vuelve. Mientras tanto reintenta con espera creciente ante 429 y 5xx.
- **Tacha los cupos que se ocuparon**: si un cupo que te aviso ya no esta en la siguiente revision,
  edita el mensaje original y lo marca "ya se ocupo", para que no corras a reservar algo que no existe.

Estaciones disponibles: Alajuela, Alajuelita, Cañas, Cartago, Guápiles, Heredia, Liberia, Limón,
Nicoya, Pérez Zeledón, Puntarenas, San Carlos, Santo Domingo, Móvil Guatuso, Móvil San Marcos
y Móvil Ciudad Neily. Se vigilan **hasta 3 a la vez** (`MAX_LOCATIONS`) para no saturar a DEKRA.

Tres modos, por prioridad:

| Modo | Cuando | Que avisa |
|---|---|---|
| **Ventana corta** (`WINDOW_DAYS=3`) | recomendado para cazar cancelaciones | cualquier fecha nueva con cupos entre hoy y +N dias |
| **Fechas objetivo** (`TARGET_DATES`) | si te sirven solo ciertos dias | cuando alguna de esas fechas tiene cupos |
| **Cita mas proxima** (ambas vacias) | para saber cuando hay algo | la primera fecha con cupos por ubicacion |

## Como funciona

```
Tu (Telegram) ──/buscar, /parar──►  Vercel api/telegram.ts  ──►  Upstash "control"
                                                                       │ (activo, ubicaciones, dias)
cron-job.org (cada 1 min, puntual)                                     │
        │  GET https://TU-APP.vercel.app/api/check                     │
        │  Authorization: Bearer <CRON_SECRET>                         ▼
        ▼                                                     lee el control; si esta
Vercel  api/check.ts  ──►  lib/run.ts  ◄──────────────────── en pausa, termina aqui
        │  1. Consulta DEKRA por cada ubicacion activa (en paralelo, ~2 s)
        │  2. Compara con el estado anterior guardado en Upstash (Redis)
        │  3. Solo avisa de fechas que ACABAN de habilitarse
        ▼
Telegram / Resend ──► un solo aviso con las novedades de todas las ubicaciones
```

- **Vercel** aloja los dos endpoints (gratis). Solo corren cuando los llaman.
- **cron-job.org** llama al de revision cada minuto (gratis y puntual, a diferencia del cron de GitHub).
- **Upstash Redis** guarda el control del bot y el estado entre corridas (gratis).
  5 comandos por corrida activa, 1 en pausa: unos 216.000 al mes como maximo, de 500.000 gratis.
- **Telegram** recibe tus ordenes por webhook y te manda el aviso como notificacion push, con boton para reservar.
- **GitHub Actions** queda como respaldo opcional (cada 5 min, impreciso).

Latencia real desde que se libera un cupo hasta que te llega el aviso: **1 a 2 minutos**.

### Deteccion por transicion

Solo te avisa cuando una fecha **acaba de habilitarse**. Mientras siga disponible no te
vuelve a escribir; si se ocupa y luego reaparece, te avisa de nuevo. Un dia cuenta como
disponible solo si el endpoint de horarios devuelve cupos reales (el de dias da falsos positivos).

### Canales de aviso

| Variable | Efecto |
|---|---|
| `NOTIFY_CHANNELS=telegram` | solo Telegram |
| `NOTIFY_CHANNELS=email` | solo correo |
| `NOTIFY_CHANNELS=email,telegram` | ambos |
| *(vacia)* | se detecta: Telegram si hay `TELEGRAM_BOT_TOKEN`, correo si hay `RESEND_API_KEY` |

### Por que no reserva sola

El sitio de DEKRA tiene captcha en el paso de confirmar, verifica clientes bloqueados y
da 5 minutos para completar la reserva. Automatizar la reserva viola sus terminos y puede
hacer que bloqueen tu correo. El aviso te deja a un boton de la pagina de reserva; ten la
cedula y la placa a mano y toma menos de un minuto.

## Estructura

```
lib/config.ts       Lee variables de entorno (ubicaciones, modo, canales)
lib/dekra.ts        Consulta los endpoints de DEKRA (dias y horarios)
lib/time.ts         Fechas y horas en zona de Costa Rica, rangos horarios
lib/store.ts        Almacen clave->JSON (backend upstash o file) + candado
lib/dedup.ts        Estado persistente: fechas vistas, fallos, pendientes, avisos enviados
lib/control.ts      "Interruptor" del bot: activo, estaciones, dias, horario, silencio, expiracion
lib/keyboards.ts    Botones de Telegram (estaciones, dias, menu)
lib/commands.ts     Interpreta comandos y botones del bot
lib/bot.ts          Procesa una actualizacion de Telegram (lo usan webhook y polling)
lib/alerts.ts       Avisos de sistema: fallos, latido diario, expiracion
lib/telegram.ts     Envia y edita mensajes por Telegram (Bot API)
lib/email.ts        Envia el correo con Resend
lib/notify.ts       Envia por todos los canales configurados
lib/run.ts          Orquesta la revision de todas las ubicaciones activas
api/check.ts        Endpoint de revision (lo llama cron-job.org cada minuto)
api/telegram.ts     Webhook del bot (Telegram lo llama con cada mensaje tuyo)
scripts/local.ts    Corre una revision en tu maquina (npm run check)
scripts/bot-local.ts          Simula un comando del bot en local (npm run bot -- /estado)
scripts/telegram-chat-id.ts   Imprime tu chat id (npm run telegram:chatid)
scripts/telegram-webhook.ts   Registra el webhook en Telegram (npm run telegram:webhook -- URL)
scripts/serve.ts    Sirve api/check.ts en local (npm run serve)
.github/workflows/  Cron de GitHub Actions (respaldo opcional)
```

---

## 1. Probar en local

```bash
npm install
cp .env.example .env      # en Windows PowerShell: copy .env.example .env
# edita .env con tus datos
npm run check
```

Veras un resumen por ubicacion y, si una fecha acaba de habilitarse, te llega el aviso.
En local el estado se guarda en `.state/` (corre dos veces para ver el dedup).

Para probar los comandos del bot sin desplegar nada:

```bash
npm run bot -- /estado
npm run bot -- "/buscar Alajuela"
npm run bot -- "@loc:go"     # simula pulsar un boton (callback_data)
npm run check                # solo revisa Alajuela
npm run bot -- /parar
npm run check                # no consulta DEKRA: "EN PAUSA"
```

Para probarlo **desde el celular** sin Vercel (mientras la terminal este abierta):

```bash
npm run bot:poll -- 60       # responde comandos y botones, y revisa citas cada 60 s
```

## 2. Configurar el canal de aviso

### Opcion A: Telegram (recomendada, gratis)

1. En Telegram busca **@BotFather**, mandale `/newbot` y sigue los pasos (nombre y usuario del bot).
   Te responde con un **token** tipo `123456789:AAH...`. Ese es `TELEGRAM_BOT_TOKEN`.
2. Abre tu bot nuevo (BotFather te da el link) y mandale cualquier mensaje, por ejemplo "hola".
   Sin este paso el bot no puede escribirte.
3. Pon el token en tu `.env` y corre:

   ```bash
   npm run telegram:chatid
   ```

   Te imprime tu `TELEGRAM_CHAT_ID` (un numero). Copialo al `.env`.
4. Si quieres avisar a mas personas, cada una le escribe al bot y agregas sus ids
   separados por coma en `TELEGRAM_CHAT_ID`.

> Para que los links abran en Chrome y no en el navegador interno de Telegram:
> Android: Ajustes -> Ajustes de chat -> desactiva "Navegador integrado".
> iPhone: Ajustes -> Datos y almacenamiento -> Navegador -> Chrome.

### Opcion B: correo con Resend

1. Entra a https://resend.com y crea cuenta (gratis).
2. Ve a **API Keys** y crea una. Copiala (empieza con `re_`).
3. Sin dominio propio, deja `EMAIL_FROM` como `onboarding@resend.dev`.
   Resend solo permite enviar a la direccion con la que te registraste,
   asi que registra Resend con el mismo correo de `EMAIL_TO`.

## 3. Crear la base en Upstash (estado entre corridas)

1. Entra a https://console.upstash.com y crea cuenta (gratis, sin tarjeta).
2. **Create Database** -> tipo **Redis**, region cualquiera de EE. UU. (cerca de Vercel).
3. En la pestaña **REST API** copia `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.

## 4. Desplegar en Vercel

1. Sube el repo a GitHub (si no lo esta): `git push`.
2. Entra a https://vercel.com, **Add New -> Project**, importa el repo `cita`.
   Framework preset: **Other**. No cambies nada mas. **Deploy**.
3. En el proyecto: **Settings -> Environment Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `TELEGRAM_BOT_TOKEN` | el token de @BotFather |
   | `TELEGRAM_CHAT_ID` | tu chat id |
   | `TELEGRAM_WEBHOOK_SECRET` | otro texto largo inventado (protege el webhook del bot) |
   | `NOTIFY_CHANNELS` | `telegram` |
   | `UPSTASH_REDIS_REST_URL` | de Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | de Upstash |
   | `CRON_SECRET` | un texto largo inventado, ej. 40 letras y numeros al azar |
   | `WINDOW_DAYS` | `3` (o los dias que te sirvan) |

   Opcionales: `TARGET_DATES`, `LOCATIONS`, `RESEND_API_KEY`, `EMAIL_TO`, `EMAIL_FROM`.
4. **Deployments -> ... -> Redeploy** para que tome las variables.
5. Prueba desde tu maquina (reemplaza la URL y el secreto):

   ```bash
   curl -H "Authorization: Bearer TU_CRON_SECRET" https://TU-APP.vercel.app/api/check
   ```

   Debe responder `{"ok":true,...}`. Sin el header debe responder 401.
   La primera corrida te avisa de todo lo que ya este disponible; despues, solo novedades.

6. Conecta el bot con Vercel (una sola vez). Pon el mismo `TELEGRAM_WEBHOOK_SECRET` en tu `.env` y corre:

   ```bash
   npm run telegram:webhook -- https://TU-APP.vercel.app
   ```

   Escribele `/estado` al bot: debe responder en un segundo. Si no, `npm run telegram:webhook -- --info`
   muestra el ultimo error que vio Telegram.

## 5. Programar cron-job.org (cada minuto)

1. Entra a https://cron-job.org y crea cuenta (gratis).
2. **Create cronjob**:
   - **URL**: `https://TU-APP.vercel.app/api/check`
   - **Schedule**: every 1 minute (o "Custom" con `* * * * *`).
   - **Advanced -> Headers**: agrega `Authorization` con valor `Bearer TU_CRON_SECRET`.
   - **Advanced -> Timeout**: 60 segundos.
3. Guarda y usa **Test run** para confirmar que responde 200.

Listo. Desde ese momento vigila cada minuto sin que tengas nada encendido.

## 6. (Opcional) GitHub Actions como respaldo

El workflow `.github/workflows/check.yml` corre cada 5 minutos, pero GitHub lo atrasa
(a veces horas) y lo desactiva tras 60 dias sin commits. Si lo quieres activo:

- **Settings -> Secrets and variables -> Actions**: agrega los mismos secretos que en Vercel,
  **incluidos los de Upstash** para que compartan el estado y no te avisen dos veces.
- **Variables**: `NOTIFY_CHANNELS`, `WINDOW_DAYS` (o `TARGET_DATES`), `LOCATIONS`.
- **Actions -> Verificar citas DEKRA -> Enable workflow**.

Si no lo necesitas, dejalo desactivado.

---

## Cambiar lo que vigila

Lo normal es hacerlo desde el bot: `/buscar Puntarenas`, `/dias 5`, `/parar`.
Lo que sigue son valores iniciales o ajustes que no tienen comando; se editan en Vercel
(**Settings -> Environment Variables**) y luego **Redeploy**.

| Variable | Valor | Default |
|---|---|---|
| `WINDOW_DAYS` | ventana inicial, `3` = hoy a +3 dias (el bot la cambia con `/dias`) | 0 (desactivado) |
| `TARGET_DATES` | `2026-10-13..2026-10-16` (rango) o `2026-10-20,2026-10-21` (sueltas), combinables. Manda sobre la ventana | vacio |
| `LOCATIONS` | `Alajuela:4e130e21-...,Puntarenas:94801ed6-...` acota las que el bot puede elegir | las 16 de DEKRA CR |
| `MAX_LOCATIONS` | maximo de estaciones vigiladas a la vez | 3 |
| `SCAN_CONCURRENCY` | cuantas estaciones consulta en paralelo | 4 |
| `EXPIRE_DAYS` | dias hasta que la busqueda se apaga sola (0 = nunca) | 14 |
| `HEARTBEAT_HOUR` | hora local del latido diario (-1 = sin latido) | 7 |
| `FAIL_ALERT_THRESHOLD` | fallos seguidos antes de avisar que DEKRA no responde | 5 |
| `DEKRA_RETRIES` | reintentos por llamada ante 429/5xx | 2 |
| `TELEGRAM_MAX_TIMES` | horarios listados por fecha en el mensaje | 8 |

## Notas

- Cuando consigas tu cita, manda `/parar` al bot. El cron sigue llamando cada minuto pero
  solo lee una clave de Upstash y termina. Si prefieres, pausa tambien el cronjob en cron-job.org.
- Sin `WINDOW_DAYS` ni `TARGET_DATES` la ventana de busqueda es de hoy a +1 mes;
  ajustala con `START_DATE` / `END_DATE`.
- El endpoint tiene un candado en Upstash para que dos corridas no se pisen si una tarda mas de un minuto.
- No conviene consultar DEKRA mas seguido que cada minuto: podrian bloquear la IP.
