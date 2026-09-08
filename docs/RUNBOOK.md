# Runbook — operación mensual

La operativa de un mes son cuatro pasos:

> **Seleccionar mes → arrastrar archivos → procesar → revisar**

No hace falta preparar carpetas, renombrar archivos, usar la terminal ni saber
qué es un hash. Todo se hace desde la aplicación.

---

## Puesta en marcha (una sola vez)

```bash
npm install
cp .env.example .env.local     # rellenar cuando exista el proyecto Supabase
npm run dev
```

Mientras Supabase no esté configurado, los documentos se guardan en la zona
local de trabajo (`local-data/`, excluida del repositorio). Cuando se configure,
pasan al bucket privado de Supabase Storage sin que cambie nada de la operativa.

---

## Paso 1 · Seleccionar el mes

En la portada, elige el mes y pulsa **Abrir mes**. Un periodo no hay que crearlo:
se abre y ya se le pueden arrastrar documentos.

---

## Paso 2 · Arrastrar los documentos

Arrastra a la zona grande **todos los documentos del mes de una vez**: 20, 40 o
100. Vale también pulsar y seleccionarlos.

Se aceptan **PDF, XLSX y CSV**:

- facturas, nóminas, impuestos, recibos de Seguridad Social, justificantes;
- extractos de la SL y de la SC;
- la Cuenta de cash Antifrágil;
- las hojas de ventas de clínica (banco y efectivo).

El sistema deduce qué es cada archivo por el nombre, la extensión, los prefijos
`G_`/`I_`, el periodo y el importe que aparezcan en el nombre, y la estructura de
las tablas. **No hay que etiquetar nada.**

Al terminar aparece el resumen:

```text
37 documentos recibidos · 34 reconocidos · 2 necesitan revisión · 1 duplicado ignorado
```

Y debajo, **solo lo problemático**. Los duplicados no molestan: subir dos veces
el mismo archivo no lo duplica, aunque llegue con otro nombre.

### Extractos

Se reconocen desde la misma zona. Si el archivo indica la entidad (SL o SC) o
lleva el IBAN dentro, la cuenta se asigna sola. Si no, aparece en **Documentos
por confirmar** con dos botones: *Es de la SL* / *Es de la SC*.

> Para que el IBAN se reconozca, configura `ANTIFRAGIL_IBAN_SL_TAIL` y
> `ANTIFRAGIL_IBAN_SC_TAIL` en `.env.local` con los últimos 4 dígitos de cada
> cuenta. No se guardan datos bancarios en el repositorio.

También existe el desplegable **Añadir extractos**, útil si prefieres indicar la
cuenta por adelantado.

---

## Paso 3 · Procesar

Pulsa **Procesar mes**. El sistema decide solo qué hacer:

- **Primera vez o extracto nuevo** → construye el mes completo.
- **Solo han llegado justificantes** → reintenta **únicamente** las incidencias
  abiertas, sin tocar lo ya conciliado ni lo que tú hayas revisado.

Después te dice qué ha hecho: movimientos, porcentaje conciliado y qué se ha
resuelto.

---

## Paso 4 · Revisar

Orden de revisión (es el de la cola):

1. **Diferencias de datáfono** — empezar por aquí si las hay.
2. **Movimientos sin documento** — buscar el justificante o confirmar que no existe.
3. **Matches ambiguos** — elegir cuál es el documento correcto.
4. **Documentos sin movimiento** — ¿pendiente de pago? ¿otro mes? ¿otra vía?
5. **Posibles duplicados**.
6. **Sin clasificar** — categoría y P&L, cuyo flujo se diseñará más adelante.

En la tabla de movimientos, el nombre del documento es un enlace: se abre en una
pestaña para comprobar **movimiento ↔ documento** sin salir del flujo.

> Lo que aparece como **"No requiere doc."** no es una excepción: es un estado
> final legítimo (comisiones, intereses, traspasos internos).

---

## Añadir documentos más tarde

Es el caso normal: septiembre queda con 5 movimientos sin justificar y mañana
aparecen 3 facturas.

1. Abre septiembre.
2. Arrastra las 3 facturas.
3. Pulsa **Procesar mes**.

Se reintentan solo esas incidencias. Nada se reconstruye ni se duplica, y lo que
ya habías revisado se respeta.

---

## Comprobaciones antes de dar un mes por bueno

- [ ] Los movimientos de las tres cuentas están, cada uno con su cuenta correcta
- [ ] No quedan documentos por confirmar
- [ ] Los movimientos internos están marcados y fuera del resultado
- [ ] El datáfono cuadra, o su diferencia está explicada
- [ ] Cada movimiento tiene estado documental explícito
- [ ] Ningún documento sin movimiento se ha convertido en gasto
- [ ] No hay duplicados sin confirmar

---

## Herramientas técnicas (no forman parte de la operativa)

El CLI se mantiene para desarrollo, depuración y tests. **No hace falta usarlo.**

```bash
npm run cfo -- inspect 2026-09   # cómo se interpretan unas fuentes en carpetas locales
npm run cfo -- analyze 2026-09   # motor completo desde carpetas locales + informes
npm run cfo -- compare 2026-08   # contrastar un mes con su cierre manual previo
npm run cfo -- demo              # el motor sobre datos sintéticos
```

Antes de tocar código:

```bash
npm run check    # typecheck + lint + tests
npm run build
```

---

## Problemas frecuentes

**"Necesita revisión" en un archivo que sí sabes qué es** → El nombre no daba
señales suficientes. Confírmalo en *Documentos por confirmar*; el archivo ya está
guardado, no hay que volver a subirlo.

**Un extracto no entra al procesar** → Le falta la cuenta. Aparece en *Documentos
por confirmar* con los botones SL/SC.

**"No se ha reconocido la cabecera"** → El archivo usa nombres de columna que el
motor no conoce. Se añaden en `SYNONYMS` de [lib/sources/table.ts](../lib/sources/table.ts).

**Demasiados "sin documento"** → Puede que falten justificantes por subir, o que
sus importes no sean legibles desde el nombre. Revisa la cola.

**Un archivo no admitido** → Solo PDF, XLSX y CSV. Una foto o un DOCX se rechazan
y se indica en el resumen.
