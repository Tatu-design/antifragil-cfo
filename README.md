# Antifrágil CFO

Sistema financiero interno de Antifrágil.

Convierte extractos bancarios, facturas, ventas de clínica y movimientos de caja
en un **ledger financiero trazable**, y el Cash Flow en una **vista calculada**
sobre él. El cierre mensual pasa de ser búsqueda y copia manual a:

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
| Motor financiero (reglas, conciliación, incidencias, idempotencia) | ✅ Implementado y testeado |
| Lectura de fuentes locales (XLSX/CSV) e informes de auditoría | ✅ Implementado |
| Esquema Supabase con RLS | ✅ Escrito, pendiente de aplicar |
| Inspección de los documentos reales de agosto 2026 | ⬜ Siguiente paso |
| Persistencia en Supabase y cierre de mes | ⬜ Pendiente |
| Integración con Google Drive | ⬜ Pendiente |
| Interfaz operativa | ⬜ Después del MVP financiero |

Mes piloto: **agosto 2026**.

---

## Stack

TypeScript · Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase (PostgreSQL + Auth + RLS) · Zod · Vitest · Vercel

Mismo stack y convenciones que el resto de aplicaciones Antifrágil.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar cuando exista el proyecto Supabase

npm run check                  # typecheck + lint + tests
npm run cfo -- demo            # el motor sobre datos sintéticos
npm run dev                    # interfaz (mínima por ahora)
```

## Uso mensual

```bash
npm run cfo -- inspect 2026-08   # lee las fuentes y explica cómo las ha entendido
npm run cfo -- analyze 2026-08   # construye el ledger, concilia y genera informes
```

Ningún comando escribe sobre los documentos originales del negocio.

Dónde dejar cada archivo y cómo revisar el resultado: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

---

## Reglas del dinero (resumen)

- **Retirada de caja no es un ingreso.** Traspasos, saldos iniciales y transferencias internas tampoco: son tesorería, fuera del P&L.
- **Datáfono**: se concilia por suma mensual (banco vs facturación de clínica), no factura a factura, y entra como **una sola línea consolidada**. Si no cuadra, se reporta la diferencia; **nunca se ajusta una cifra**.
- **Ventas cash de clínica**: salen de su Excel, nunca de las retiradas de caja.
- **Prohibida la doble contabilización**: liquidaciones + facturas de venta son el mismo ingreso; movimiento bancario + factura son el mismo gasto.
- **Una factura sin movimiento no se convierte en gasto**: se reporta como incidencia.
- **Nada se clasifica sin una regla explícita.** Hoy el catálogo está vacío a propósito: la decisión contable es humana hasta validar la taxonomía histórica.
- **Idempotencia**: procesar el mismo mes dos veces no duplica nada.
- **Trazabilidad**: cada cifra sabe de qué archivo, hoja y fila viene.

Detalle completo: **[docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md)**.

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [docs/SYSTEM_VISION.md](docs/SYSTEM_VISION.md) | ⭐ Visión, contexto de negocio y decisiones cerradas |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | Las reglas del dinero, que son la especificación del motor |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, estructura y decisiones técnicas |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Ledger, tablas, RLS e idempotencia |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operación mensual paso a paso |
| [CLAUDE.md](CLAUDE.md) | Instrucciones para Claude Code |

---

## Tests

```bash
npm run test
```

Cubren los diez casos que el negocio necesita que salgan bien: gasto con factura,
gasto sin factura, factura sin movimiento, ingreso sin factura, datáfono que cuadra,
datáfono que no cuadra, gasto en efectivo, retirada de caja, prevención de duplicados
e idempotencia — más el recorrido completo desde archivos en disco.

Todos los datos de test son sintéticos.
