# Reglas financieras

> Este documento es la especificación funcional del motor. Cada regla que aquí
> aparece está implementada y cubierta por tests. Si una regla cambia, cambian
> a la vez: este documento, el código y el test que la protege.

Prioridad del sistema, en este orden y sin excepciones:

**1. Exactitud financiera · 2. Trazabilidad · 3. Seguridad · 4. Automatización · 5. Velocidad · 6. Interfaz**

Ante la duda, el motor no decide: deja el apunte pendiente y genera una incidencia.
Es mejor una revisión de un minuto que una cifra inventada.

---

## 1. Unidades y signos

- Todo importe vive como **entero de céntimos**. Nunca se opera en coma flotante sobre euros.
- El signo es el del movimiento real: **negativo = sale dinero**.
- Un importe que no se puede interpretar **no se convierte en cero**: se marca la fila como problemática y se reporta `SOURCE_ERROR`.

Implementación: [lib/finance/money.ts](../lib/finance/money.ts)

---

## 2. Naturaleza de cada apunte

| Dirección | Qué es | ¿Entra en P&L? |
|-----------|--------|----------------|
| `income` | Ingreso real | Sí |
| `expense` | Gasto real | Sí |
| `internal` | Movimiento interno de tesorería | **No, nunca** |

Un movimiento interno mueve dinero de un sitio a otro sin crear ni destruir riqueza.

### Se consideran movimientos internos

- Retirada de caja
- Retirada de efectivo
- Cantidad inicial / saldo inicial
- Traspasos entre cuentas o cajas
- Transferencias internas
- Ingreso de efectivo en caja o banco

> **RETIRADA DE CAJA NO ES UN INGRESO.** Es la regla que más veces se rompe al hacer esto a mano.

Ante la duda, el motor **no** marca como interno: prefiere que el apunte quede
visible y pendiente antes de desaparecer del P&L en silencio.

La base de datos también lo impide: un apunte `internal` con categoría o P&L
viola una restricción CHECK de PostgreSQL.

Implementación: [lib/finance/internal.ts](../lib/finance/internal.ts)

---

## 3. Clasificación contable (categoría y P&L)

- La clasificación automática es **determinista y basada en reglas explícitas**. No hay IA decidiendo categorías.
- Cada regla tiene id, palabras que deben aparecer, palabras que no, ámbito, confianza y un motivo escrito.
- Si **no hay regla aplicable** → `category = null`, `pnl = null`, estado `pending`.
- Si **dos reglas compiten** con resultados distintos → también `pending`. Un conflicto de reglas lo resuelve una persona, no el motor.
- Una clasificación introducida a mano (`manual`) **sobrevive a cualquier reprocesado**.

### Estado actual del catálogo

**El catálogo arranca vacío a propósito.** Hasta analizar el histórico enero–julio 2026
del `Cash Flow GEA 2026` y validar la taxonomía con el propietario, **todo gasto
bancario nuevo queda pendiente de clasificación manual**.

Esto es deliberado: el motor introduce el movimiento y su documentación; la
decisión contable (COGS, Personal Directo, Personal Estructura, OPEX Directo,
OPEX Estructura…) es humana hasta que exista una regla escrita que la respalde.

### Excepción: clasificación heredada

Si un documento de origen ya trae categoría y P&L asignados por una persona
—caso de la `Cuenta de cash Antifrágil`— esa clasificación **se conserva** y se
marca como `manual`. No es una inferencia del motor: es una decisión humana previa.

Implementación: [lib/finance/rules.ts](../lib/finance/rules.ts)

---

## 4. Datáfono de clínica

El banco agrupa muchas operaciones de tarjeta en una liquidación; las facturas de
venta están individualizadas. Por eso **no se concilia factura a factura**.

### Detección

Todo movimiento cuyo concepto normalizado contenga `liquidacion` + `remesas` +
`comercio` (o variante inequívocamente equivalente) es datáfono de clínica.
Lo que no encaja **no** se trata como datáfono: se revisa como ingreso normal,
que es el lado seguro del error.

### Conciliación agregada

```text
TOTAL_DATÁFONO_BANCO   = suma de las liquidaciones del mes
TOTAL_FACTURACIÓN      = suma del Excel de ventas de clínica cobradas por banco
DIFERENCIA             = TOTAL_DATÁFONO_BANCO - TOTAL_FACTURACIÓN
```

- `DIFERENCIA = 0` → **DATÁFONO CONCILIADO**
- `DIFERENCIA ≠ 0` → **DATÁFONO NO CONCILIADO** + incidencia `CARD_SETTLEMENT_MISMATCH` (gravedad *error*)

**Ninguna cifra se ajusta jamás para hacerlas coincidir.**

### Cómo entra en el Cash Flow

Una **única línea consolidada** de ingreso: `Clínica / Fisioterapia Playamar — Banco`,
con el Excel de ventas asociado como documento, y la lista de movimientos
consolidados guardada en `aggregates` para poder rastrearlos.

Las liquidaciones individuales **no** aparecen como ingresos separados.

> **Supuesto documentado (a confirmar con el histórico de julio):** la línea
> consolidada reconoce el **importe efectivamente cobrado en banco**. Si difiere de
> la facturación, la diferencia queda como incidencia, nunca como ajuste. Si al
> inspeccionar julio resulta que el criterio histórico es el contrario (reconocer
> la facturación), se cambia aquí y en el test que lo cubre.

Implementación: [lib/finance/card-settlements.ts](../lib/finance/card-settlements.ts)

---

## 5. Ingresos de clínica en efectivo

- La fuente correcta es el **Excel mensual de ventas cobradas en cash**.
- **Nunca** se calculan desde las retiradas de caja.
- Entran como **una única línea**: `Clínica / Fisioterapia Playamar — Cash`, con su documento asociado.
- No hace falta cuadrar este importe contra las retiradas: son cosas distintas.

---

## 6. Prohibición de doble contabilización

Tres casos, una misma regla: **una realidad económica se reconoce una sola vez**.

| Caso | Fuentes que describen el mismo hecho | Qué se reconoce |
|------|--------------------------------------|-----------------|
| Datáfono | Liquidaciones del banco + facturas de venta | Una línea consolidada |
| Cash clínica | Ventas en efectivo + retirada posterior de caja | Solo la venta |
| Gastos | Movimiento bancario + factura del proveedor | Un gasto, con la factura como documento |

Además, una entrada de efectivo anotada en la `Cuenta de cash` **no se reconoce
como ingreso**: casi siempre es el reflejo de ventas que ya se reconocen desde su
propio Excel. Se registra como movimiento interno y se emite un
`DUPLICATE_SUSPECT` informativo para que una persona lo confirme.

Una factura solo puede asociarse a **un** movimiento: así una misma factura no
justifica dos pagos distintos.

---

## 7. Conciliación documental (bidireccional)

### A · Movimiento → factura

Para cada gasto se buscan facturas candidatas:

- **El importe es condición necesaria** (tolerancia configurable, por defecto exacta).
- La fecha debe caer dentro de una ventana (45 días por defecto).
- Se puntúan proveedor (similitud de tokens), cercanía de fecha y presencia del nº de factura en el concepto.

| Resultado | Estado |
|-----------|--------|
| Un candidato claro y respaldado por proveedor o nº de factura | `matched` |
| Varios candidatos con puntuación similar, o solo coincide el importe | `ambiguous` + incidencia `AMBIGUOUS_MATCH` |
| Ningún candidato | `missing_document` + incidencia `EXPENSE_WITHOUT_INVOICE` |

**Nunca se fuerza una asociación dudosa.**

### B · Factura → movimiento

Para cada factura del mes sin movimiento asociado → incidencia `INVOICE_WITHOUT_MOVEMENT`.

**La factura NO se convierte en gasto.** Puede estar pendiente de pago, pagada en
otro mes, pagada por otra vía o ser un error documental. Eso lo decide una persona.

Implementación: [lib/finance/matching.ts](../lib/finance/matching.ts)

---

## 8. Ingresos bancarios que no son datáfono

Se revisan uno a uno. Si no se localiza documento justificativo → incidencia
`INCOME_WITHOUT_INVOICE`. El ingreso sigue en el ledger: lo que falta es su papel.

---

## 9. Enlaces a documentos

- Si una factura tiene URL o ID de Google Drive, se conserva y viaja con el apunte hasta el Cash Flow.
- **Si no existe URL de Drive, no se inventa.** El campo queda `null`.

---

## 10. Idempotencia

Procesar dos veces el mismo mes debe producir exactamente el mismo resultado.

- El id de cada apunte es un **hash determinista** de: fuente + periodo + fecha + importe + concepto normalizado + ordinal de repetición.
- No depende del orden de lectura, de la hora ni de ningún contador.
- Dos movimientos económicamente idénticos el mismo día son dos apuntes legítimos: el ordinal los distingue de forma estable.
- Al fusionar una nueva ejecución sobre la anterior: los ids existentes se actualizan (nunca se duplican), se preserva la clasificación manual y el estado aprobado, y los apuntes que ya no aparecen en la fuente **se conservan y se reportan** en lugar de desaparecer.

Implementación: [lib/finance/dedupe.ts](../lib/finance/dedupe.ts)

---

## 11. Higiene de fuentes

- Un movimiento con fecha fuera del periodo **no se incorpora** y se reporta (`SOURCE_ERROR`).
- Las filas de totales/subtotales se descartan solo si no tienen fecha válida: una fila con fecha nunca se tira.
- Los errores de fórmula heredados (`#REF!`, `#VALUE!`…) se detectan y se reportan; no se propagan ni se interpretan como ceros.
- Si el libro tiene pestañas mensuales, se usa **solo la del periodo** (`AGOSTO 26` ↔ `2026-08`). Leer todas mezclaría meses.

---

## 12. Catálogo de incidencias

| Tipo | Gravedad por defecto | Significado |
|------|----------------------|-------------|
| `EXPENSE_WITHOUT_INVOICE` | warning (info en cash) | Gasto sin factura localizada |
| `INVOICE_WITHOUT_MOVEMENT` | warning | Factura sin pago localizado |
| `INCOME_WITHOUT_INVOICE` | warning | Ingreso sin documentación |
| `CARD_SETTLEMENT_MISMATCH` | **error** | El datáfono no cuadra |
| `AMBIGUOUS_MATCH` | warning | Varias facturas posibles; ninguna asociada |
| `DUPLICATE_SUSPECT` | warning / info | Posible duplicado o posible doble reconocimiento |
| `FORMULA_ERROR` | **error** | Error de fórmula en un documento de origen |
| `SOURCE_ERROR` | **error** | Archivo faltante, ilegible o fuera de periodo |

Los ids de incidencia también son deterministas: reprocesar no genera incidencias duplicadas.

---

## 13. Modo seguro

- Los comandos actuales (`inspect`, `analyze`) **solo leen**. No escriben en ningún documento del negocio.
- Antes de cualquier escritura futura sobre datos reales: copia de seguridad, previsualización, incidencias, validación y aprobación explícita.
- Los documentos históricos originales (Drive, Sheets) **no se modifican**.
