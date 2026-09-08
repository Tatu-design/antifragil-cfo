# Arquitectura

**Misión de esta etapa:** conciliar los movimientos de las tres tesorerías con su
documentación justificativa y dejar las excepciones revisables desde la interfaz.
Todo lo que sigue está al servicio de eso.

## Stack

| Capa | Elección | Motivo |
|------|----------|--------|
| Lenguaje | TypeScript | D2 — mismo lenguaje que el resto del ecosistema Antifrágil |
| Framework | Next.js 16.3 (App Router) + React 19 | D3/D4 y principio de compatibilidad D14 (ver nota) |
| Estilos | Tailwind CSS v4 | D10 |
| Base de datos | Supabase / PostgreSQL | D6 |
| Auth | Supabase Auth + SSR + RLS | D7/D47 |
| Validación | Zod | D11 |
| Hosting | Vercel | D8 |
| Package manager | npm | D9 |
| Tests | Vitest | Rápido, ejecuta TypeScript directamente |
| Lectura de Excel | ExcelJS | Node puro, lee valores calculados y errores de fórmula |
| Drive | API REST v3 tras una interfaz `DriveClient` | Solo hacen falta dos operaciones de listado; el método de auth (O1) no afecta al resto del código |

> **Nota sobre la versión de Next.** `SYSTEM_VISION` fija Next.js 15 (D3), pero los
> repositorios de referencia (`App Lidomare`, `antifragil-portal`) están en la línea
> 16.2/16.3 con React 19.2. El principio de compatibilidad (D14) manda. Sigue siendo
> App Router, que es lo que D3 protege.

---

## Principio estructural

El motor financiero es **código puro, sin dependencias de framework ni de red**:
recibe datos, devuelve datos. No sabe si lo llama un CLI, un Server Component o un test.

```text
   Extractos SL/SC        ┌──────────────────────────────────────────┐
   Cuenta de cash    ───► │  MOTOR  (lib/finance/)                   │ ──► Ledger
   Ventas clínica         │  puro · determinista · testeable         │     Incidencias
                          │  sin Next, sin Supabase, sin red         │     Cola de revisión
   Drive ──► índice  ───► └──────────────────────────────────────────┘     Métricas MVP
             (lib/drive/)         ▲                    ▲
                                  │                    │
                          lib/sources/          scripts/cfo.ts (CLI)
                          lectura local         app/ (interfaz)
```

Esto es lo que permite probar cada regla en milisegundos y cambiar el almacenamiento
o la interfaz sin tocar las reglas.

---

## Estructura de carpetas

```text
antifragil-cfo/
├── CLAUDE.md · .claude/CLAUDE.md    Instrucciones del agente
├── .env.example                     Plantilla de variables (sin secretos)
│
├── app/                             Next.js App Router
│   ├── page.tsx                     Portada: elegir periodo
│   └── periodo/[period]/page.tsx    Vista operativa del mes
├── proxy.ts                         Sesión Supabase + protección de rutas
├── next.config.ts                   Cabeceras de seguridad (CSP, HSTS…)
│
├── lib/
│   ├── finance/                     ⭐ MOTOR — sin dependencias externas
│   │   ├── types.ts                 Modelo de dominio
│   │   ├── accounts.ts              Cuentas de tesorería (SL, SC, caja)
│   │   ├── money.ts                 Aritmética en céntimos enteros
│   │   ├── period.ts                Periodos y fechas ISO
│   │   ├── text.ts                  Normalización y similitud
│   │   ├── dedupe.ts                Ids deterministas, fusión, idempotencia
│   │   ├── internal.ts              Movimientos internos de tesorería
│   │   ├── document-requirements.ts ¿Necesita documento este movimiento?
│   │   ├── card-settlements.ts      Datáfono: detección y conciliación agregada
│   │   ├── matching.ts              Puntuación y cardinalidades de match
│   │   ├── reconciliation.ts        Orquestación de la conciliación
│   │   ├── rules.ts                 Clasificación determinista por reglas
│   │   ├── incidents.ts             Catálogo y construcción de incidencias
│   │   ├── ledger.ts                ⭐ Construcción del ledger del periodo
│   │   ├── review-queue.ts          Cola de excepciones
│   │   ├── period-view.ts           Vista operativa + métricas MVP
│   │   └── compare.ts               Motor vs cierre manual
│   │
│   ├── drive/                       Índice documental
│   │   ├── types.ts                 DriveClient, IndexedDocument
│   │   ├── index-documents.ts       Sincronización acotada e indexación
│   │   └── client.ts                Cliente REST (server-only)
│   │
│   ├── sources/                     Lectura de fuentes locales
│   │   ├── workbook.ts              XLSX y CSV → matriz de celdas
│   │   ├── table.ts                 Cabeceras y mapeo por sinónimos
│   │   ├── discover.ts              Descubrimiento y deducción de cuenta
│   │   └── adapters.ts              Filas leídas → entrada del motor
│   │
│   ├── inspect/                     Fase INSPECT e informes de auditoría
│   ├── supabase/                    client · server · admin (service role)
│   ├── period-store.ts              Lectura de periodos analizados (server-only)
│   └── paths.ts                     Rutas de la zona local de datos
│
├── scripts/cfo.ts                   CLI: inspect · analyze · compare · demo
├── supabase/migrations/             Esquema versionado con RLS
├── tests/                           Vitest + fixtures sintéticas
└── local-data/                      ⛔ NO VERSIONADA — datos reales
    ├── inputs/<YYYY-MM>/{bank_sl,bank_sc,cash_account,clinic_bank,clinic_cash,documents,manual_close}
    ├── outputs/<YYYY-MM>/           Informes y ledger.json
    ├── backups/ · logs/
```

---

## Flujo de datos

```text
1. DESCUBRIR    discover.ts        ¿Qué archivos hay, de qué tipo y de qué cuenta?
2. LEER         workbook.ts        XLSX/CSV → celdas en bruto
3. INTERPRETAR  table.ts           ¿Dónde está la cabecera? ¿Qué columna es el importe?
4. ADAPTAR      adapters.ts        Filas → movimientos, ventas, documentos
   (en paralelo) drive/            Drive → índice documental
5. CONSTRUIR    ledger.ts          Reglas financieras → movimientos + incidencias
6. CONCILIAR    reconciliation.ts  Movimiento ↔ documento, 4 cardinalidades
7. PRIORIZAR    review-queue.ts    Excepciones ordenadas por gravedad
8. PRESENTAR    period-view.ts     Vista operativa + métricas del MVP
                app/               Interfaz de revisión
                                   (9. PERSISTIR en Supabase — siguiente fase)
```

El paso 3 es el que habrá que afinar con los documentos reales: se amplían sinónimos
de columna, no se reescriben las reglas financieras.

---

## Interfaz operativa

Hoy lee el `ledger.json` que produce `npm run cfo -- analyze`, a través de
`lib/period-store.ts`. Cuando Supabase esté conectado, **solo cambia esa capa**: la
interfaz consume la misma forma de datos.

- `/` — periodos analizados.
- `/periodo/[period]` — métricas MVP, desglose por tesorería, cola de revisión y tabla de movimientos con estado documental y enlace al documento.

Pendiente inmediato: poder **clasificar desde la tabla** y guardar la decisión como
regla (Fase 8).

---

## Seguridad

- **RLS activo en todas las tablas** desde la primera migración. Sin fila en `cfo_members`, un usuario autenticado no ve nada.
- **Sin políticas de DELETE**: los datos financieros no se borran desde la aplicación.
- **`service_role` y credenciales de Drive solo en servidor**: `lib/supabase/admin.ts`, `lib/drive/client.ts` y `lib/period-store.ts` importan `server-only`, así que el build falla si alguien los arrastra al cliente.
- **Cabeceras**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy y HSTS en producción.
- **Ningún dato financiero real en el repositorio**: `.gitignore` bloquea `local-data/`, las extensiones de documento y los nombres de los documentos reales conocidos.

---

## Decisiones técnicas

| Decisión | Motivo |
|----------|--------|
| Importes en céntimos enteros | Un redondeo en coma flotante es un error financiero silencioso |
| Fechas como cadena ISO, sin `Date` en el dominio | Evita desplazamientos de zona horaria entre documentos |
| Ids deterministas por hash, con la cuenta dentro | Hace posible la idempotencia real y distingue cuentas |
| `accountId` en cada movimiento | Cuadrar cada tesorería por separado |
| `not_document_required` como estado final | Sin él, la cola de revisión se llena de ruido permanente |
| Evidencia (método, score, motivos) en cada match | Auditar un match automático meses después |
| Búsqueda de subconjuntos acotada a 4 movimientos | Evita "encontrar" sumas casuales que no significan nada |
| Índice documental en vez de recorrer Drive | Rápido, reproducible y auditable |
| `DriveClient` como interfaz | La decisión de autenticación (O1) no bloquea el desarrollo |
| Catálogo de reglas vacío al arrancar | No clasificar es mejor que clasificar mal |
| Detección de columnas por sinónimos | Los formatos reales aún no se conocen; nada de celdas fijas |
| Motor sin dependencias de framework | Tests en milisegundos y libertad para cambiar interfaz o almacenamiento |
