# Runbook — operación mensual

Guía práctica. Qué archivos dejar, dónde, y qué comando ejecutar.

---

## Puesta en marcha (una sola vez)

```bash
cd antifragil-cfo
npm install
cp .env.example .env.local     # rellenar cuando exista el proyecto Supabase
```

Comprobar que todo está sano:

```bash
npm run check        # typecheck + lint + tests
npm run cfo -- demo  # el motor sobre datos sintéticos, sin tocar nada real
```

---

## Dónde va cada documento

Todo lo real vive en `local-data/`, que **nunca** se sube a GitHub.

```text
local-data/inputs/2026-08/
├── bank/           Extracto bancario del mes            (.xlsx / .csv)
├── expenses/       Facturas de gastos                   (.pdf y/o índice .xlsx/.csv)
├── income/         Documentos justificativos de ingresos
├── clinic_bank/    Ventas de clínica cobradas por banco/datáfono   (.xlsx)
├── clinic_cash/    Ventas de clínica cobradas en efectivo          (.xlsx)
├── cash_account/   Cuenta de cash Antifrágil (pestaña del mes)     (.xlsx)
└── master/         Cash Flow GEA 2026, como referencia histórica   (.xlsx)
```

Reglas prácticas:

- **La carpeta manda** sobre el nombre del archivo para decidir el tipo. Si un archivo está suelto en la raíz del periodo, se intenta deducir por el nombre (`extracto`, `ventas clínica banco`, prefijos `G_` / `I_`) y, si no se puede, se reporta como *sin clasificar* en vez de adivinar.
- Los Google Sheets (`Cash Flow GEA 2026`, `Cuenta de cash Antifrágil`) se descargan como **.xlsx** mientras no exista la integración con Drive.
- Si el libro tiene pestañas mensuales, no hay que recortar nada: el motor usa la del periodo (`AGOSTO 26` ↔ `2026-08`).
- Se puede cambiar la ubicación de los datos con `ANTIFRAGIL_CFO_DATA_DIR` en `.env.local`.

---

## Paso 1 · Inspeccionar (mirar sin tocar)

```bash
npm run cfo -- inspect 2026-08
```

Qué hace: descubre los archivos, los abre, y **explica cómo ha entendido cada uno**
—qué fila es la cabecera, qué columna es el importe, cuántas filas ha leído, qué
rango de fechas cubren y cuánto suman.

Qué **no** hace: no clasifica, no concilia, no escribe en ningún documento.

Salida: `local-data/outputs/2026-08/inspection_report.md`

**Este informe hay que leerlo.** Es el momento de detectar que una columna no se
reconoció o que un archivo se interpretó mal, antes de que ninguna cifra entre en
el ledger. Si algo no encaja, se amplían los sinónimos de columna en
[lib/sources/table.ts](../lib/sources/table.ts) y se vuelve a ejecutar.

---

## Paso 2 · Analizar (motor completo, sin persistir)

```bash
npm run cfo -- analyze 2026-08
```

Construye el ledger, aplica todas las reglas financieras, concilia y genera:

| Archivo | Contenido |
|---------|-----------|
| `inspection_report.md` | Cómo se han interpretado las fuentes |
| `reconciliation_report.md` | Datáfono, gastos↔facturas, facturas sin movimiento, ingresos sin documento, movimientos internos |
| `incidents.json` | Incidencias estructuradas |
| `run_summary.md` | Resumen, Cash Flow del mes y estado final |
| `ledger.json` | Todos los apuntes con su trazabilidad completa |

Código de salida: `0` correcto · `2` hay incidencias de gravedad *error* (por ejemplo, datáfono descuadrado).

Ejecutarlo dos veces seguidas produce exactamente el mismo resultado: es idempotente por diseño.

---

## Paso 3 · Revisar

Por este orden:

1. **`run_summary.md` → sección Estado.** Si hay errores, empezar por ahí.
2. **Datáfono.** ¿`DIFERENCIA = 0`? Si no, la diferencia está sin tocar y a la vista. Nunca se ajusta sola.
3. **Facturas faltantes** y **facturas sin movimiento**.
4. **Ingresos sin documentación.**
5. **Apuntes pendientes de clasificar.** Hoy son todos los gastos bancarios nuevos, por decisión: la categoría y el P&L los decides tú.
6. **Sospechas de duplicado.**

---

## Qué hacer con cada incidencia

| Incidencia | Qué significa | Qué hacer |
|------------|---------------|-----------|
| `EXPENSE_WITHOUT_INVOICE` | Gasto sin factura localizada | Buscar la factura, o aceptar que no la hay |
| `INVOICE_WITHOUT_MOVEMENT` | Factura sin pago localizado | ¿Pendiente de pago? ¿Pagada en otro mes? ¿Otra cuenta? |
| `INCOME_WITHOUT_INVOICE` | Ingreso sin documentación | Localizar el documento |
| `CARD_SETTLEMENT_MISMATCH` | El datáfono no cuadra | Revisar si falta una liquidación o una venta. **Nunca cuadrar a mano** |
| `AMBIGUOUS_MATCH` | Varias facturas encajan | Elegir cuál es la correcta |
| `DUPLICATE_SUSPECT` | Posible duplicado | Confirmar si son dos hechos reales o uno repetido |
| `SOURCE_ERROR` | Archivo faltante, ilegible o fila fuera de periodo | Revisar la fuente |
| `FORMULA_ERROR` | El documento de origen trae `#REF!` u otro error | Corregir en origen; no se propaga |

---

## Comprobaciones antes de dar un mes por bueno

- [ ] Todos los movimientos del extracto están (ninguno perdido en silencio)
- [ ] Los movimientos internos están marcados como tales y fuera del resultado
- [ ] El datáfono cuadra, o su diferencia está explicada
- [ ] Las ventas cash vienen de su Excel, no de las retiradas
- [ ] Ninguna factura sin movimiento se ha convertido en gasto
- [ ] No hay duplicados sin confirmar
- [ ] Cada cifra puede rastrearse hasta archivo y fila
- [ ] `npm run check` en verde

---

## Antes de tocar código

```bash
npm run check    # typecheck + lint + tests
npm run build    # build de producción
```

Una tarea no está terminada porque compile (D51). Si cambia una regla financiera,
cambian a la vez la regla, su test y [FINANCIAL_RULES.md](./FINANCIAL_RULES.md).

---

## Problemas frecuentes

**"No se ha reconocido la cabecera"** → El archivo usa nombres de columna que el
motor no conoce. Añadir el sinónimo en `SYNONYMS` de [lib/sources/table.ts](../lib/sources/table.ts).

**Importes x1000 o divididos** → Formato numérico raro. Revisar `parseAmountToCents`
en [lib/finance/money.ts](../lib/finance/money.ts) y añadir un test con ese formato exacto.

**Fechas desplazadas un día** → Serial de Excel o zona horaria. Todo el dominio usa
cadenas ISO precisamente para evitarlo; revisar `parseDateToISO`.

**"Movimiento fuera del periodo"** → El extracto incluye días de otro mes. Es correcto
que no entre; se reporta para que quede constancia.
