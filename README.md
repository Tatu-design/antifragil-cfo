# Antifrágil CFO

Sistema financiero interno de Antifrágil.

**Misión actual:** conciliar todos los movimientos reales de tesorería —banco SL,
banco SC y caja— con su documentación justificativa, y permitir revisar y clasificar
las excepciones desde una interfaz.

> El cierre mensual pasa de ser búsqueda y copia manual a:
> **procesar → revisar excepciones → aprobar**

---

## ⚠️ Este repositorio es público

Contiene **únicamente** código, documentación, migraciones, tests y datos sintéticos.

**Nunca** contiene extractos, facturas, importes reales, documentos de clientes,
`Cash Flow GEA 2026`, `Cuenta de cash Antifrágil`, credenciales ni secretos.
Todo dato real vive en `local-data/`, excluida por `.gitignore`.

---

## Estado

| Parte | Estado |
|-------|--------|
| Ledger multi-cuenta (SL, SC, caja) | ✅ Implementado y testeado |
| Conciliación documental (4 cardinalidades, con evidencia) | ✅ Implementado y testeado |
| Cola de excepciones y métricas MVP | ✅ Implementado y testeado |
| Interfaz operativa de revisión (lectura) | ✅ Funcionando sobre datos locales |
| Índice documental de Drive | 🟡 Motor y tests listos; falta credencial |
| Persistencia en Supabase | 🟡 Esquema escrito; falta aplicarlo |
| Carga de documentos por arrastre, con reconocimiento automático | ✅ Funcionando |
| Almacenamiento privado y carga incremental | ✅ Funcionando (local; Supabase Storage listo) |
| Clasificación desde la interfaz | ⬜ Aplazado a propósito |
| Reconstrucción y comparación de agosto 2026 | 🟡 Motor listo; faltan los archivos reales |
| Septiembre 2026 operativo | ⬜ Objetivo inmediato |

Fuera del MVP por decisión explícita: Cash Flow operativo, EBITDA, balances,
presupuestos, forecasting y reporting avanzado.

---

## Stack

TypeScript · Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase (PostgreSQL + Auth + RLS) · Zod · Vitest · Vercel

Mismo stack y convenciones que el resto de aplicaciones Antifrágil.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar cuando exista el proyecto Supabase
npm run dev
```

## Uso mensual

Todo desde la aplicación, en cuatro pasos:

> **Seleccionar mes → arrastrar archivos → procesar → revisar**

1. Abre el mes desde la portada.
2. Arrastra **todos los documentos de una vez** (PDF, XLSX y CSV): facturas,
   nóminas, impuestos, extractos de la SL y la SC, cuenta de cash y hojas de
   ventas. El sistema deduce qué es cada uno y resume la carga.
3. Pulsa **Procesar mes**.
4. Revisa solo las excepciones. Desde cada asiento se abre su documento.

Añadir documentos más tarde reprocesa únicamente las incidencias abiertas.
Subir dos veces el mismo archivo no lo duplica.

Guía completa: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

---

## Reglas del dinero (resumen)

- **Tres tesorerías, un solo ledger**, y cada movimiento conserva su cuenta de origen.
- **Documento justificativo, no solo factura**: nóminas, impuestos, Seguridad Social, recibos y hojas de ventas cuentan igual.
- **No todo necesita documento**: comisiones, intereses y traspasos internos quedan en `not_document_required`, un estado final legítimo y no una excepción.
- **Nunca se fuerza un match dudoso**, y toda asociación guarda método, confianza y motivos.
- **Retirada de caja no es un ingreso.** Traspasos y saldos iniciales tampoco.
- **Datáfono**: conciliado por suma mensual y consolidado en una sola línea. Si no cuadra, se reporta la diferencia; **nunca se ajusta una cifra**.
- **Ventas cash de clínica**: salen de su Excel, nunca de las retiradas de caja.
- **Un documento sin movimiento no se convierte en gasto**: se reporta.
- **Nada se clasifica sin una regla explícita.** La decisión contable es humana hasta validar la taxonomía histórica.
- **Agosto 2026 es referencia, no verdad infalible**: se reconstruye, se compara, y cada diferencia la juzga una persona.
- **Idempotencia**: procesar el mismo mes dos veces no duplica nada.
- **Trazabilidad**: cada cifra sabe de qué archivo, hoja y fila viene.

Detalle completo: **[docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md)**.

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/SYSTEM_VISION.md](docs/SYSTEM_VISION.md) | ⭐ Visión, contexto de negocio y decisiones cerradas |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | Las reglas del dinero: la especificación del motor |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, estructura y decisiones técnicas |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Ledger, documentos, conciliación, RLS e idempotencia |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operación mensual paso a paso |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Qué está hecho y el camino más corto a septiembre |
| [CLAUDE.md](CLAUDE.md) | Instrucciones para Claude Code |

---

## Tests

```bash
npm run test
```

84 tests con datos sintéticos: multi-cuenta, documentos justificativos de varios
tipos, las cuatro cardinalidades de matching, datáfono (cuadra y no cuadra), cash y
movimientos internos, cola de excepciones, métricas, idempotencia, índice de Drive,
comparación con cierres manuales, reconocimiento y carga de documentos, reprocesado
incremental y el recorrido completo desde archivos en disco.

## Herramientas técnicas

El CLI (`npm run cfo -- ...`) se mantiene para desarrollo, depuración y tests. No
forma parte del flujo del usuario.
