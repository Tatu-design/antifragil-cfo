# Reglas financieras

> Especificación funcional del motor. Cada regla aquí escrita está implementada y
> cubierta por tests. Si una regla cambia, cambian a la vez: este documento, el
> código y el test que la protege.

**Misión de esta etapa:** conciliar todos los movimientos reales de tesorería con
su documentación justificativa, y dejar las excepciones listas para revisión.

Orden de prioridad, sin excepciones:

**1. Movimiento correcto · 2. Documentación correcta · 3. Conciliación correcta · 4. Clasificación**

Ante la duda, el motor no decide: deja el movimiento en su estado real y genera
una incidencia. Es mejor una revisión de un minuto que una cifra inventada.

---

## 1. Unidades y signos

- Todo importe vive como **entero de céntimos**. Nunca se opera en coma flotante sobre euros.
- El signo es el del movimiento real: **negativo = sale dinero**.
- Un importe ilegible **no se convierte en cero**: se marca la fila y se reporta `SOURCE_ERROR`.

Implementación: [lib/finance/money.ts](../lib/finance/money.ts)

---

## 2. Tesorerías

Se procesan tres cuentas, y todas convergen en un único ledger:

| Id | Cuenta | Tipo | Entidad |
|----|--------|------|---------|
| `sl_bank` | Banco SL | banco | SL |
| `sc_bank` | Banco SC | banco | SC |
| `cash` | Caja Antifrágil | efectivo | SL |

- **Cada movimiento conserva siempre su `accountId`.** Sin eso no se puede cuadrar cada tesorería por separado.
- La cuenta se deduce de la **carpeta de entrada**, no del contenido: explícito y sin ambigüedad.
- La cuenta forma parte del **identificador** del movimiento: el mismo importe el mismo día en la SL y en la SC son dos movimientos distintos, no un duplicado.

Implementación: [lib/finance/accounts.ts](../lib/finance/accounts.ts)

---

## 3. Naturaleza de cada movimiento

| Dirección | Qué es | ¿Entra en el resultado? |
|-----------|--------|-------------------------|
| `income` | Ingreso real | Sí |
| `expense` | Gasto real | Sí |
| `internal` | Movimiento interno de tesorería | **No, nunca** |

Son movimientos internos: retirada de caja, retirada de efectivo, cantidad o saldo
inicial, traspasos, transferencias internas e ingresos de efectivo en caja o banco.

> **RETIRADA DE CAJA NO ES UN INGRESO.** Es la regla que más veces se rompe a mano.

Ante la duda el motor **no** marca como interno: prefiere que el movimiento quede
visible y pendiente antes de desaparecer del resultado en silencio. La base de
datos también lo impide: un movimiento `internal` con categoría o P&L viola una
restricción CHECK.

Implementación: [lib/finance/internal.ts](../lib/finance/internal.ts)

---

## 4. Documento justificativo, no solo factura

No todo movimiento se justifica con una factura. El sistema trata por igual:

`invoice` · `payroll` (nómina) · `tax` (impuesto) · `social_security` · `receipt` ·
`sales_sheet` · `bank_statement` · `contract` · `other`

### Estados de conciliación

| Estado | Significado | ¿Es excepción? |
|--------|-------------|----------------|
| `pending` | Aún no evaluado | — |
| `reconciled` | Documento localizado y asociado con evidencia suficiente | No |
| `missing_document` | Debería tener documento y no se ha encontrado | **Sí** |
| `ambiguous` | Varios documentos plausibles; ninguno asociado | **Sí** |
| `not_document_required` | No requiere documento por su naturaleza | No: **estado final legítimo** |

### Qué no requiere documento

- Todos los **movimientos internos**: no hay tercero que emita nada.
- Comisiones y mantenimiento bancario, intereses, redondeos.

La lista es corta y explícita a propósito. Solo entra lo inequívoco; cualquier duda
se queda como `missing_document` y la revisa una persona. Cuando un movimiento queda
exento, **se guarda el motivo** (la base de datos lo exige).

Implementación: [lib/finance/document-requirements.ts](../lib/finance/document-requirements.ts)

---

## 5. Índice documental de Drive

Drive sigue siendo el repositorio de los archivos, pero **el motor nunca recorre
Drive para conciliar**: consulta un índice.

```text
Drive → sincronización acotada al periodo → índice en Supabase → motor
```

- Se navega **solo la rama del periodo** (Año → Trimestre → Tipo → Mes). Se descartan explícitamente las carpetas de otro año, trimestre o mes; se entra en los niveles genéricos ("2. Facturas").
- La sincronización es **idempotente**: la clave es el `drive_file_id`, que Drive garantiza estable.
- De cada documento se guarda: id, nombre, URL, MIME, ruta de carpeta, periodo, tipo documental, emisor, importe, señales usadas para deducirlo (`inferred_from`) y `synced_at`.
- Lo que no se puede deducir queda `null`. **Nunca se inventa** un importe, un emisor, un periodo ni una URL.

Implementación: [lib/drive/](../lib/drive/)

---

## 6. Conciliación: cardinalidades

| Caso | Cuándo ocurre | Método |
|------|---------------|--------|
| 1 movimiento ↔ 1 documento | Lo habitual | `amount_date_issuer` / `reference_in_concept` |
| 1 movimiento ↔ N documentos | Un pago que liquida varias facturas del mismo emisor | `aggregate_sum` |
| N movimientos ↔ 1 documento | Una nómina o impuesto pagado en varios cargos | `aggregate_sum` |
| Agregado de periodo | Datáfono | `aggregate_period` |

Reglas comunes:

- **El importe es condición necesaria** (tolerancia configurable, por defecto exacta), salvo que la referencia del documento aparezca literalmente en el concepto.
- Ventana de fechas: 45 días por defecto.
- Las sumas de grupo deben ser **exactas** y el emisor coherente; el grupo se limita a 4 movimientos para no "encontrar" sumas casuales.
- **Un documento solo justifica un movimiento o un grupo.** Así una misma factura no respalda dos pagos.
- Si dos candidatos puntúan casi igual → `ambiguous`, y no se asocia ninguno.

### Evidencia obligatoria

Toda asociación automática guarda **método, confianza (0–1) y motivos legibles**
("importe exacto", "3 días de diferencia", "emisor ~0.92"). Es lo que permite
auditar meses después por qué el motor decidió lo que decidió.

Implementación: [lib/finance/matching.ts](../lib/finance/matching.ts) y [lib/finance/reconciliation.ts](../lib/finance/reconciliation.ts)

---

## 7. Documentos sin movimiento

Por cada documento del periodo que no se ha podido asociar → incidencia
`DOCUMENT_WITHOUT_MOVEMENT`.

**El documento NO se convierte en movimiento.** Puede estar pendiente de pago,
pagado en otro mes, pagado por otra vía o ser un error documental. Eso lo decide
una persona.

---

## 8. Datáfono de clínica

El banco agrupa muchas operaciones de tarjeta en una liquidación; las ventas están
individualizadas. Por eso **no se concilia venta a venta**.

### Detección

Concepto normalizado que contenga `liquidacion` + `remesas` + `comercio` (o variante
inequívocamente equivalente). Lo que no encaja **no** se trata como datáfono: se
revisa como ingreso normal, que es el lado seguro del error.

### Conciliación agregada

```text
TOTAL_DATÁFONO_BANCO = suma de las liquidaciones del mes
TOTAL_FACTURACIÓN    = suma del Excel de ventas de clínica cobradas por banco
DIFERENCIA           = TOTAL_DATÁFONO_BANCO - TOTAL_FACTURACIÓN
```

- `DIFERENCIA = 0` → **DATÁFONO CONCILIADO**
- `DIFERENCIA ≠ 0` → **NO CONCILIADO** + incidencia `CARD_SETTLEMENT_MISMATCH` (gravedad *error*)

**Ninguna cifra se ajusta jamás para que coincidan.**

Entra en el ledger como **una única línea consolidada** con el Excel de ventas como
documento (`aggregate_period`) y la lista de movimientos consolidados en `aggregates`.

> **Supuesto pendiente de confirmar con el histórico de julio:** la línea reconoce el
> **importe cobrado en banco**. Si el criterio histórico resulta ser reconocer la
> facturación, se cambia aquí, en el motor y en su test.

Implementación: [lib/finance/card-settlements.ts](../lib/finance/card-settlements.ts)

---

## 9. Ingresos de clínica en efectivo

- Fuente correcta: el **Excel mensual de ventas cobradas en cash**.
- **Nunca** se calculan desde las retiradas de caja.
- Entran como **una única línea** en la cuenta `cash`.

---

## 10. Prohibición de doble contabilización

| Caso | Fuentes que describen el mismo hecho | Qué se reconoce |
|------|--------------------------------------|-----------------|
| Datáfono | Liquidaciones del banco + ventas del Excel | Una línea consolidada |
| Cash clínica | Ventas en efectivo + retirada posterior | Solo la venta |
| Gastos | Movimiento bancario + documento justificativo | Un movimiento, con el documento asociado |

Además, una entrada de efectivo anotada en la `Cuenta de cash` **no se reconoce como
ingreso**: casi siempre refleja ventas ya reconocidas desde su Excel. Se registra
como movimiento interno con un `DUPLICATE_SUSPECT` informativo.

---

## 11. Clasificación (categoría y P&L)

En esta etapa **no es prioritario** que todo se clasifique automáticamente.

- Si existe una **regla histórica inequívoca** (habilitada y con confianza suficiente), se aplica y se guarda el id de la regla.
- Si no la hay, o si dos reglas compiten con resultados distintos → `category = null`, `pnl = null`, estado `pending`.
- El catálogo **arranca vacío a propósito**: hasta validar la taxonomía histórica, todo queda pendiente.
- La clasificación se completa **desde la interfaz**, con opción de *"guardar esta decisión como regla para futuros movimientos similares"* (la tabla guarda de qué movimiento se aprendió).
- Una clasificación `manual` **sobrevive a cualquier reprocesado**. También sobrevive una conciliación ya revisada por una persona.

### Excepción: clasificación heredada

Si un documento de origen ya trae categoría y P&L puestos por una persona —caso de
la `Cuenta de cash Antifrágil`— se conservan y se marcan como `manual`.

Implementación: [lib/finance/rules.ts](../lib/finance/rules.ts)

---

## 12. Idempotencia

Procesar dos veces el mismo mes produce exactamente el mismo resultado.

- El id de cada movimiento es un **hash determinista** de: fuente + periodo + **cuenta** + fecha + importe + concepto normalizado + ordinal de repetición.
- No depende del orden de lectura, de la hora ni de ningún contador.
- Al fusionar ejecuciones: los ids existentes se actualizan (nunca se duplican), se preservan clasificación manual, documentos y estado revisado/aprobado, y los movimientos que ya no aparecen en la fuente **se conservan y se reportan**.

Implementación: [lib/finance/dedupe.ts](../lib/finance/dedupe.ts)

---

## 13. Comparación con cierres manuales

Agosto 2026 se cerró a mano. Es una referencia valiosa, **no una verdad infalible**.

- El motor reconstruye el mes desde las fuentes y **compara**.
- Empareja por importe, fecha y descripción; aísla lo que solo está en un lado y los importes distintos.
- Los movimientos internos no se comparan: no aparecen en un cierre.
- **Toda diferencia nace como `pending`.** Los veredictos posibles (`probable_engine_error`, `probable_manual_error`, `criteria_difference`) los pone una persona.
- El informe aporta evidencia objetiva (origen, fila, documento asociado) sin concluir.

> **Regla explícita:** si el motor difiere del cierre manual, **no** se retoca el
> algoritmo para reproducir el resultado histórico. Primero se entiende la causa;
> solo se cambia el motor si el equivocado es el motor.

Implementación: [lib/finance/compare.ts](../lib/finance/compare.ts)

---

## 14. Higiene de fuentes

- Un movimiento con fecha fuera del periodo **no se incorpora** y se reporta (`SOURCE_ERROR`).
- Las filas de totales/subtotales se descartan solo si no tienen fecha válida.
- Los errores de fórmula heredados (`#REF!`…) se detectan y reportan; no se propagan ni se leen como ceros.
- Si un libro tiene pestañas mensuales, se usa **solo la del periodo**.

---

## 15. Catálogo de incidencias

| Tipo | Gravedad | Significado |
|------|----------|-------------|
| `MOVEMENT_WITHOUT_DOCUMENT` | warning (info en cash) | Movimiento sin documento justificativo |
| `DOCUMENT_WITHOUT_MOVEMENT` | warning | Documento sin movimiento localizado |
| `INCOME_WITHOUT_DOCUMENT` | warning | Ingreso sin documentación |
| `CARD_SETTLEMENT_MISMATCH` | **error** | El datáfono no cuadra |
| `AMBIGUOUS_MATCH` | warning | Varios documentos posibles; ninguno asociado |
| `DUPLICATE_SUSPECT` | warning / info | Posible duplicado o doble reconocimiento |
| `UNCLASSIFIED_MOVEMENT` | info | Movimientos pendientes de categoría y P&L |
| `FORMULA_ERROR` | **error** | Error de fórmula en un documento de origen |
| `SOURCE_ERROR` | **error** | Archivo faltante, ilegible o fila fuera de periodo |

Los ids de incidencia también son deterministas.

---

## 16. Cola de revisión

Lo único que una persona debe mirar cada mes, ordenado por prioridad:

1. Diferencias de datáfono
2. Movimientos sin documento
3. Matches ambiguos
4. Documentos sin movimiento
5. Posibles duplicados
6. Movimientos sin clasificar

Lo que el motor resuelve con evidencia suficiente **no aparece aquí**. Lo que está
`not_document_required` tampoco: es un estado final, no una excepción.

Implementación: [lib/finance/review-queue.ts](../lib/finance/review-queue.ts)

---

## 17. Métricas del MVP (y solo estas)

Ingresos totales · gastos totales · flujo neto de caja · movimientos y neto por
tesorería · % de movimientos conciliados · nº de movimientos pendientes · importe
pendiente de justificar · gastos por categoría · gastos por P&L.

**Cash Flow operativo, EBITDA, balances, presupuestos y forecasting quedan fuera**
hasta que la conciliación sea de fiar.

---

## 18. Modo seguro

- Los comandos actuales (`inspect`, `analyze`, `compare`) **solo leen**.
- Antes de cualquier escritura sobre datos reales: copia de seguridad, previsualización, incidencias, validación y aprobación explícita.
- Los documentos históricos originales (Drive, Sheets) **no se modifican**.
