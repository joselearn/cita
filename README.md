# Cita DEKRA Watcher

Verifica automaticamente la disponibilidad de citas en DEKRA (desde hoy hasta 1 mes)
en varias ubicaciones (por defecto **Alajuela** y **Puntarenas**) y te envia un correo:

- Si defines **tus fechas objetivo** (`TARGET_DATES`): te avisa cuando alguna este disponible.
- Si **no** defines fechas objetivo: te avisa de la **cita mas proxima disponible** por ubicacion.

## Como funciona

```
GitHub Actions (cron cada 10 min)
        │  ejecuta el script en el runner
        │  + cachea .state/ entre corridas (dedup)
        ▼
  npm run check
        │  1. Consulta DEKRA por cada ubicacion
        │  2. Compara con tus fechas (TARGET_DATES)
        │  3. Solo avisa de fechas que ACABAN de habilitarse
        ▼
Resend  ──► un solo correo con las novedades de todas las ubicaciones
```

- **GitHub Actions** corre el script cada 10 min y guarda el estado del dedup en su cache.
  No necesita Vercel ni Upstash.
- **Resend** envia el correo (100 correos/dia gratis).

### Deteccion por transicion (clave para correr cada 10 min)

El sistema solo te avisa cuando una fecha **acaba de habilitarse**. Mientras siga disponible
no te vuelve a escribir; si se ocupa y luego reaparece, te avisa de nuevo. Ideal para cazar
cupos que se abren y cierran cada pocos minutos.

Para recordar el estado entre corridas hay dos opciones (el codigo elige automaticamente):

| Backend | Cuando se usa | Donde sirve |
|---|---|---|
| **file** (`.state/available.json`) | por defecto, sin configurar nada | local y GitHub Actions (cacheando el archivo) |
| **upstash** (Redis) | si defines `UPSTASH_REDIS_REST_URL/TOKEN` | tambien en Vercel |

Este proyecto usa el backend **file** + cache de GitHub Actions, asi que **no hace falta Upstash**.

## Estructura

```
lib/config.ts       Lee variables de entorno (ubicaciones, fechas, correo)
lib/dekra.ts        Consulta el endpoint de DEKRA por ubicacion
lib/dedup.ts        Deteccion por transicion (backend file o upstash)
lib/email.ts        Envia el correo con Resend
lib/run.ts          Orquesta todas las ubicaciones
scripts/local.ts    Para probar en tu maquina (npm run check)
api/check.ts        Endpoint serverless de Vercel (opcional, para pruebas manuales)
scripts/serve.ts    Sirve api/check.ts en local (npm run serve)
.github/workflows/  Cron cada 10 min de GitHub Actions (ejecutor principal)
```

---

## 1. Probar en local

```bash
npm install
cp .env.example .env      # en Windows PowerShell: copy .env.example .env
# edita .env con tus datos
npm run check
```

Veras un resumen por ubicacion y, si una fecha acaba de habilitarse, te llega el correo.
El estado se guarda en `.state/available.json` (corre dos veces para ver el dedup en accion).

## 2. Crear la API key de Resend

1. Entra a https://resend.com y crea cuenta (gratis).
2. Ve a **API Keys** y crea una. Copiala (empieza con `re_`).
3. Sin dominio propio, deja `EMAIL_FROM` como `onboarding@resend.dev`.
   Resend solo permite enviar a la direccion con la que te registraste,
   asi que registra Resend con el mismo correo de `EMAIL_TO`.

## 3. Subir a GitHub

```bash
git init
git add .
git commit -m "DEKRA cita watcher"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

## 4. Configurar los secretos y variables en GitHub

En tu repo: **Settings -> Secrets and variables -> Actions**.

**Secrets** (pestaña Secrets -> New repository secret):

| Secret | Valor |
|---|---|
| `RESEND_API_KEY` | tu key de Resend (`re_...`) |
| `EMAIL_TO` | el correo donde quieres recibir los avisos |

**Variables** (pestaña Variables -> New repository variable), todas opcionales:

| Variable | Valor | Default si la omites |
|---|---|---|
| `TARGET_DATES` | `2026-05-22` o `2026-06-15,2026-06-16` | vacio = cita mas proxima |
| `EMAIL_FROM` | `DEKRA Watcher <onboarding@resend.dev>` | ese mismo |
| `LOCATIONS` | `Alajuela:4e130e21-...,Puntarenas:94801ed6-...` | Alajuela y Puntarenas |

## 5. Activar el cron

El workflow corre **cada 10 minutos** automaticamente. Para probarlo ya mismo:
**Actions -> Verificar citas DEKRA -> Run workflow**.

> En repos nuevos, GitHub a veces deja los workflows programados en pausa hasta que haces
> al menos una ejecucion manual (Run workflow). Hazla una vez para activarlo.

### Alternativa mas precisa: cron-job.org (opcional)

El cron de GitHub Actions **no es exacto**: puede atrasarse varios minutos en horas pico.
Si necesitas precision real podrias desplegar el endpoint en Vercel y usar
[cron-job.org](https://cron-job.org), pero entonces necesitarias Upstash para el dedup
(el disco de Vercel no persiste). Para la mayoria de los casos, GitHub Actions alcanza.

---

## Cambiar tus fechas objetivo o ubicaciones

Edita la variable `TARGET_DATES` (o `LOCATIONS`) en GitHub (y en tu `.env` para local).
No hace falta tocar codigo. Si dejas `TARGET_DATES` vacia, te avisa de la cita mas proxima.

## Notas

- Cuando consigas tu cita, desactiva el workflow en GitHub (**Actions -> ... -> Disable workflow**).
- La ventana de busqueda por defecto es de hoy a +1 mes; ajustala con `START_DATE` / `END_DATE`.
- El cron de GitHub usa hora **UTC**.
- `api/check.ts` y `npm run serve` son opcionales (solo para probar el endpoint estilo Vercel).
