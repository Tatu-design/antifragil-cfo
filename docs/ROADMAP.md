# Roadmap

Estado a 8 de septiembre de 2026.

**Misión actual:** conciliar todos los movimientos reales de tesorería con su
documentación y permitir revisar y clasificar las excepciones desde la interfaz.

---

## ✅ Hecho

### Fundación
- Discovery de los repositorios Antifrágil y proyecto Next.js 16 + React 19 + TS + Tailwind v4.
- `.gitignore` endurecido antes del primer commit. Repositorio público sin datos reales.

### Modelo multi-cuenta
- Tres tesorerías (banco SL, banco SC, caja) convergiendo en un único ledger.
- Cada movimiento conserva su `accountId`, que además forma parte de su identificador.
- Métricas y desglose por cuenta y entidad legal.

### Motor de conciliación documental
- Concepto de **documento justificativo** (factura, nómina, impuesto, Seguridad Social, recibo, hoja de ventas, contrato).
- Estados: `pending`, `reconciled`, `missing_document`, `ambiguous`, `not_document_required`.
- Cuatro cardinalidades: 1↔1, 1↔N, N↔1 y agregado de periodo (datáfono).
- Toda asociación guarda **método, confianza y motivos**.
- Reglas de "no requiere documento" (comisiones, intereses, movimientos internos) con motivo obligatorio.

### Índice documental de Drive
- Navegación **acotada a la rama del periodo**, descartando otros años, trimestres y meses.
- Indexación idempotente por `drive_file_id`, con deducción de tipo, periodo, emisor e importe y registro de las señales usadas.
- Cliente REST detrás de una interfaz, para que la decisión de autenticación (O1) no bloquee nada.

### Cola de excepciones e interfaz
- Cola priorizada: datáfono, sin documento, ambiguos, documentos sin movimiento, duplicados, sin clasificar.
- Interfaz de lectura: portada de periodos y vista mensual con métricas MVP, desglose por tesorería, cola y tabla de movimientos con enlace al documento.

### Comparación con cierres manuales
- Motor de comparación que aísla diferencias y aporta evidencia, **sin decidir quién se equivocó**.

### Calidad
- **60 tests** en verde con datos sintéticos. Typecheck, lint y build limpios.
- Esquema Supabase con RLS, sin DELETE, y reglas financieras como restricciones CHECK.

---

## ⏭️ Camino más corto hasta septiembre 2026

### 1. Extractos reales de las tres cuentas (bloqueante)
Dejar en `local-data/inputs/2026-09/` los extractos de SL y SC, la cuenta de cash y
los Excels de ventas de clínica. Ejecutar `inspect` y ajustar sinónimos de columna
según el informe. Es lo único que hoy impide procesar un mes real.

### 2. Documentos: Drive o carpeta local
Dos vías, y la primera ya sirve para arrancar:
- **Rápida:** dejar los documentos del mes en `documents/`.
- **Definitiva:** credencial de Drive (O1) + `NEXT_PUBLIC` de la carpeta raíz, y sincronizar el índice.

### 3. Persistencia en Supabase
Crear el proyecto, aplicar la migración, dar de alta miembros y validar RLS. Upsert
idempotente sobre los ids deterministas. `lib/period-store.ts` pasa a leer de ahí.

### 4. Clasificación desde la interfaz
Server Actions para asignar categoría y P&L, y para *"guardar esta decisión como
regla"*. Es lo que reduce el trabajo mes a mes.

### 5. Septiembre operativo
Primer periodo producido íntegramente por Antifrágil CFO.

---

## En paralelo: agosto 2026 como control

Reconstruir agosto desde las fuentes y ejecutar `compare 2026-08` contra el cierre
manual. Cada diferencia se clasifica como error del motor, error histórico,
diferencia de criterio o pendiente. **No se ajusta el motor para reproducir el
cierre manual sin entender antes la causa.**

Sirve para validar el motor; no bloquea el arranque de septiembre.

---

## Después

| Fase | Contenido |
|------|-----------|
| Automatización mensual | Cierre reducido a importar y revisar excepciones |
| Migración histórica | Enero–julio 2026 al nuevo sistema (O3) |
| Fuera del MVP | Cash Flow operativo, EBITDA, balances, presupuestos, forecasting, reporting |

---

## Decisiones abiertas

| ID | Pregunta | Quién decide |
|----|----------|--------------|
| O1 | Autenticación con Google Drive: OAuth vs cuenta de servicio | Claude propone / CTO valida |
| O2 | Formato exacto de cada extracto (SL y SC pueden diferir) | Se determina inspeccionando los archivos reales |
| O3 | Cuándo migrar enero–julio 2026 | Propietario |
| O4 | Permisos de usuarios administrativos adicionales | Propietario |

### Supuesto pendiente de confirmar

La línea consolidada de datáfono reconoce el **importe cobrado en banco**. Si el
criterio histórico es reconocer la facturación, se cambia la regla, su test y
`FINANCIAL_RULES.md`.
