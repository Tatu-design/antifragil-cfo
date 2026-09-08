# Runbook — operación mensual

Qué archivos dejar, dónde, y qué ejecutar. La misión de cada mes es **conciliar los
movimientos con su documentación y revisar las excepciones**.

---

## Puesta en marcha (una sola vez)

```bash
cd antifragil-cfo
npm install
cp .env.example .env.local     # rellenar cuando exista el proyecto Supabase
```

Comprobar que todo está sano:

```bash
npm run check         # typecheck + lint + tests
npm run cfo -- demo   # el motor sobre datos sintéticos, sin tocar nada real
```

---

## Dónde va cada documento

Todo lo real vive en `local-data/`, que **nunca** se sube a GitHub.
Si las carpetas no existen, `npm run cfo -- inspect <periodo>` las crea.

```text
local-data/inputs/2026-09/
├── bank_sl/        Extracto de la cuenta de la SL            (.xlsx / .csv)
├── bank_sc/        Extracto de la cuenta de la SC            (.xlsx / .csv)
├── cash_account/   Cuenta de cash Antifrágil                 (.xlsx)
├── clinic_bank/    Ventas de clínica cobradas por datáfono   (.xlsx)
├── clinic_cash/    Ventas de clínica cobradas en efectivo    (.xlsx)
├── documents/      Documentos justificativos (mientras Drive no esté conectado)
└── manual_close/   Cierre manual previo del mes, solo para comparar
```

Reglas prácticas:

- **La carpeta determina la cuenta.** Un extracto en `bank_sl/` es de la SL. Es explícito y evita tener que reconocer IBAN o entidad.
- En `documents/` valen tanto PDFs sueltos como un índice `.xlsx`/`.csv` con columnas de fecha, proveedor, nº y importe. Un PDF sin importe legible se indexa igual, pero solo podrá conciliarse por referencia.
- Los Google Sheets se descargan como `.xlsx` mientras no exista la integración con Drive.
- Si un libro tiene pestañas mensuales, no hay que recortarlo: el motor usa la del periodo.
- Se puede cambiar la ubicación de los datos con `ANTIFRAGIL_CFO_DATA_DIR` en `.env.local`.

---

## Paso 1 · Inspeccionar (mirar sin tocar)

```bash
npm run cfo -- inspect 2026-09
```

Descubre los archivos, los abre y **explica cómo ha entendido cada uno**: qué fila es
la cabecera, qué columna es el importe, a qué cuenta pertenece, cuántas filas ha
leído, qué rango de fechas cubren y cuánto suman.

No clasifica, no concilia, no escribe en ningún documento.

Salida: `local-data/outputs/2026-09/inspection_report.md`

**Este informe hay que leerlo.** Es el momento de detectar que una columna no se
reconoció, antes de que ninguna cifra entre en el ledger. Si algo no encaja, se
amplían los sinónimos en [lib/sources/table.ts](../lib/sources/table.ts).

---

## Paso 2 · Analizar (motor completo)

```bash
npm run cfo -- analyze 2026-09
```

Construye el ledger de las tres tesorerías, concilia contra la documentación y genera:

| Archivo | Contenido |
|---------|-----------|
| `inspection_report.md` | Cómo se han interpretado las fuentes |
| `reconciliation_report.md` | Estado documental por cuenta, datáfono, movimientos sin documento, documentos sin movimiento, evidencia de cada match |
| `review_queue.json` | La cola de excepciones |
| `incidents.json` | Incidencias estructuradas |
| `run_summary.md` | Resumen, métricas y estado final |
| `ledger.json` | Todos los movimientos con su trazabilidad (lo lee la interfaz) |

Código de salida: `0` correcto · `2` hay incidencias de gravedad *error*.

Ejecutarlo dos veces produce exactamente el mismo resultado.

---

## Paso 3 · Revisar en la interfaz

```bash
npm run dev
```

- `/` — lista de periodos analizados.
- `/periodo/2026-09` — métricas, desglose por tesorería, **cola de revisión** y todos los movimientos con su estado documental.

Orden de revisión recomendado (es el de la cola):

1. **Diferencias de datáfono** — si las hay, empezar por ahí.
2. **Movimientos sin documento** — buscar el justificante o confirmar que no existe.
3. **Matches ambiguos** — elegir cuál es el documento correcto.
4. **Documentos sin movimiento** — ¿pendiente de pago? ¿otro mes? ¿otra vía?
5. **Posibles duplicados** — confirmar si son dos hechos reales o uno repetido.
6. **Sin clasificar** — asignar categoría y P&L.

> Lo que aparece como **"No requiere doc."** no es una excepción: es un estado final
> legítimo (comisiones, intereses, traspasos internos).

---

## Paso 4 · Comparar con el cierre manual (solo agosto 2026)

```bash
npm run cfo -- compare 2026-08
```

Requiere el Cash Flow del mes en `local-data/inputs/2026-08/manual_close/`.

Genera `comparison_report.md` con los totales de ambos lados y cada diferencia
aislada: **solo en el motor**, **solo en el cierre manual** o **importe distinto**.

**Ninguna versión se presume correcta.** Toda diferencia nace como `pending`, y hay
que clasificarla como:

| Veredicto | Cuándo |
|-----------|--------|
| `probable_engine_error` | El motor ha leído mal, ha duplicado o se ha dejado algo |
| `probable_manual_error` | El cierre manual se dejó un movimiento o puso mal un importe |
| `criteria_difference` | Ambos son defendibles: cambia el criterio (fecha, consolidación, clasificación) |

> **Nunca** se retoca el algoritmo para reproducir un resultado histórico sin
> entender antes la causa.

---

## Comprobaciones antes de dar un mes por bueno

- [ ] Los movimientos de las tres cuentas están, cada uno con su cuenta correcta
- [ ] Los movimientos internos están marcados y fuera del resultado
- [ ] El datáfono cuadra, o su diferencia está explicada
- [ ] Las ventas cash vienen de su Excel, no de las retiradas
- [ ] Cada movimiento tiene estado documental explícito
- [ ] Ningún documento sin movimiento se ha convertido en gasto
- [ ] No hay duplicados sin confirmar
- [ ] Cada cifra puede rastrearse hasta archivo y fila
- [ ] `npm run check` en verde

---

## Antes de tocar código

```bash
npm run check    # typecheck + lint + tests
npm run build
```

Si cambia una regla financiera, cambian a la vez la regla, su test y
[FINANCIAL_RULES.md](./FINANCIAL_RULES.md).

---

## Problemas frecuentes

**"No se ha reconocido la cabecera"** → El archivo usa nombres de columna que el
motor no conoce. Añadir el sinónimo en `SYNONYMS` de [lib/sources/table.ts](../lib/sources/table.ts).

**Un extracto suelto aparece como "sin clasificar"** → No dice a qué cuenta pertenece.
Colocarlo en `bank_sl/` o `bank_sc/`.

**Importes x1000 o divididos** → Formato numérico raro. Revisar `parseAmountToCents`
en [lib/finance/money.ts](../lib/finance/money.ts) y añadir un test con ese formato.

**Demasiados "sin documento"** → Puede faltar la carpeta `documents/`, o que los
documentos no tengan importe legible. Revisar el informe de inspección.

**"Movimiento fuera del periodo"** → El extracto incluye días de otro mes. Es
correcto que no entre; se reporta para que quede constancia.
