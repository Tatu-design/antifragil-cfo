# Arquitectura

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
| Tests | Vitest | Rápido, sin configuración, ejecuta TypeScript directamente |
| Lectura de Excel | ExcelJS | Node puro, lee valores calculados y errores de fórmula. Provisional hasta ver los formatos reales (O2) |

> **Nota sobre la versión de Next.** `SYSTEM_VISION` fija Next.js 15 (D3), pero los
> repositorios de referencia (`App Lidomare`, `antifragil-portal`) están en la línea
> 16.2/16.3 con React 19.2. El principio de compatibilidad (D14) manda: se usa la
> misma línea que el ecosistema. Sigue siendo App Router, que es lo que D3 protege.

Se han inspeccionado como referencia los repositorios locales `App Lidomare` y
`antifragil-portal`. De ellos vienen: la estructura sin `src/`, el alias `@/*`,
los clientes Supabase en `lib/supabase/`, el `proxy.ts` de sesión, la carpeta
`supabase/migrations/` y el patrón de `CLAUDE.md` como puntero.

---

## Principio estructural

El motor financiero es **código puro, sin dependencias de framework ni de red**:
recibe datos, devuelve datos. No sabe si lo llama un CLI, un Server Action o un test.

```text
                 ┌──────────────────────────────────────────────┐
   Archivos      │  MOTOR FINANCIERO  (lib/finance/)            │
   locales   ──► │  puro, determinista, testeable               │ ──► Ledger
   (o Drive)     │  sin Next, sin Supabase, sin red             │     Incidencias
                 └──────────────────────────────────────────────┘     Cash Flow
                        ▲                              ▲
                        │                              │
                 lib/sources/                   scripts/cfo.ts (CLI)
                 lectura y adaptación           app/ (interfaz, después)
```

Esto es lo que permite probar cada regla financiera en milisegundos y que la
interfaz llegue después sin reescribir nada.

---

## Estructura de carpetas

```text
antifragil-cfo/
├── CLAUDE.md                  Puntero: dónde están las instrucciones
├── .claude/CLAUDE.md          Constitución del agente
├── README.md
├── .env.example               Plantilla de variables (sin secretos)
│
├── app/                       Next.js App Router (interfaz mínima por ahora)
├── proxy.ts                   Sesión Supabase + protección de rutas
├── next.config.ts             Cabeceras de seguridad (CSP, HSTS, frame-options)
│
├── lib/
│   ├── finance/               ⭐ MOTOR — reglas financieras, sin dependencias
│   │   ├── types.ts           Modelo de dominio del ledger
│   │   ├── money.ts           Aritmética en céntimos enteros
│   │   ├── period.ts          Periodos y fechas (ISO, sin objetos Date)
│   │   ├── text.ts            Normalización y similitud de conceptos
│   │   ├── dedupe.ts          Ids deterministas, fusión e idempotencia
│   │   ├── internal.ts        Movimientos internos de tesorería
│   │   ├── card-settlements.ts Datáfono: detección y conciliación agregada
│   │   ├── matching.ts        Conciliación bidireccional con facturas
│   │   ├── rules.ts           Clasificación determinista por reglas
│   │   ├── incidents.ts       Catálogo y construcción de incidencias
│   │   ├── ledger.ts          ⭐ Construcción del ledger del periodo
│   │   └── cashflow.ts        Cash Flow como vista calculada
│   │
│   ├── sources/               Lectura de fuentes
│   │   ├── workbook.ts        XLSX y CSV → matriz de celdas
│   │   ├── table.ts           Detección de cabeceras y mapeo por sinónimos
│   │   ├── discover.ts        Descubrimiento de archivos de un periodo
│   │   └── adapters.ts        Filas leídas → entrada del motor
│   │
│   ├── inspect/               Fase INSPECT e informes de auditoría
│   │   ├── inspect.ts         Mirar sin tocar + informe de inspección
│   │   └── reports.ts         Conciliación y resumen de ejecución
│   │
│   ├── supabase/              client (navegador) · server (SSR) · admin (service role)
│   └── paths.ts               Rutas de la zona local de datos
│
├── scripts/cfo.ts             CLI: inspect · analyze · demo
├── supabase/migrations/       Esquema versionado con RLS
├── tests/                     Vitest + fixtures sintéticas
├── config/                    Configuración de ejemplo (sin datos reales)
├── docs/                      Esta documentación
└── local-data/                ⛔ NO VERSIONADA — datos financieros reales
    ├── inputs/<YYYY-MM>/{bank,expenses,income,clinic_bank,clinic_cash,cash_account,master}
    ├── outputs/<YYYY-MM>/     Informes generados
    ├── backups/               Copias de documentos originales
    └── logs/
```

---

## Flujo de datos

```text
1. DESCUBRIR    discover.ts     ¿Qué archivos hay y de qué tipo son?
2. LEER         workbook.ts     XLSX/CSV → celdas en bruto
3. INTERPRETAR  table.ts        ¿Dónde está la cabecera? ¿Qué columna es el importe?
4. ADAPTAR      adapters.ts     Filas → movimientos, ventas, facturas
5. CONSTRUIR    ledger.ts       Reglas financieras → apuntes + incidencias
6. PROYECTAR    cashflow.ts     Ledger → Cash Flow del mes
7. INFORMAR     reports.ts      Informes de auditoría en Markdown
                                (8. PERSISTIR en Supabase — siguiente fase)
```

Cada paso es independiente y testeable por separado. El paso 3 es el que habrá
que afinar cuando lleguen los documentos reales: se amplían sinónimos de columna,
no se reescriben las reglas financieras.

---

## Seguridad

- **RLS activo en todas las tablas** desde la primera migración. Sin fila en `cfo_members`, un usuario autenticado no ve nada.
- **Sin políticas de DELETE**: los datos financieros no se borran desde la aplicación. Corregir es escribir, no hacer desaparecer.
- **`service_role` solo en servidor**: `lib/supabase/admin.ts` importa `server-only`, así que el build falla si alguien lo arrastra al cliente.
- **Cabeceras**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy y HSTS en producción.
- **Ningún dato financiero real en el repositorio**: `.gitignore` bloquea `local-data/`, extensiones de documento y los nombres de los documentos reales conocidos.

---

## Decisiones técnicas tomadas en esta fase

| Decisión | Motivo |
|----------|--------|
| Importes en céntimos enteros | Un redondeo en coma flotante es un error financiero silencioso |
| Fechas como cadena ISO, sin `Date` en el dominio | Evita desplazamientos de zona horaria entre documentos de distintas herramientas |
| Ids deterministas por hash en vez de UUID | Es lo que hace posible la idempotencia real (D26) |
| Motor sin dependencias de framework | Tests en milisegundos y libertad para cambiar interfaz o almacenamiento |
| Catálogo de reglas vacío al arrancar | No clasificar es mejor que clasificar mal (D31) |
| Detección de columnas por sinónimos | Los formatos reales aún no se conocen; nada de posiciones fijas de celda |
| ExcelJS | Lee valores calculados y conserva los errores de fórmula para reportarlos |
| Vitest | Ejecuta TypeScript sin build; el ciclo de prueba de una regla es inmediato |
