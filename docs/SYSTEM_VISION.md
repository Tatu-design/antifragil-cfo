# SYSTEM_VISION.md — Antifrágil CFO

> ⭐ **Este es el documento más importante del proyecto.**
>
> Define la visión de negocio, las reglas principales y las decisiones ya tomadas para **Antifrágil CFO**.
>
> Claude Code debe leer este documento completo al inicio de cada sesión antes de tomar decisiones relevantes de arquitectura, producto o lógica financiera.
>
> Las decisiones marcadas como cerradas NO deben reabrirse salvo que el propietario del proyecto lo solicite expresamente con nueva información.
>
> En caso de conflicto entre una decisión técnica de implementación y una regla de negocio recogida aquí, debe preservarse la regla de negocio y plantearse una solución técnica compatible.

---

## 1. ¿Qué es este proyecto?

**Antifrágil CFO** es una aplicación financiera interna para automatizar progresivamente el control económico mensual de Antifrágil.

Su función inicial es transformar información que actualmente está dispersa entre:

* extractos bancarios;
* facturas;
* Google Drive;
* cuenta de cash;
* hojas de Cash Flow;
* documentación de ingresos;

en un único sistema financiero estructurado, trazable y automatizable.

El proyecto debe reducir al mínimo el trabajo manual de:

* copiar movimientos bancarios;
* buscar facturas;
* relacionar facturas con movimientos;
* detectar documentación faltante;
* clasificar gastos e ingresos;
* conciliar datáfono;
* incorporar movimientos cash;
* construir el Cash Flow mensual;
* revisar incidencias.

El objetivo no es digitalizar simplemente el Excel actual.

El objetivo es **extraer su lógica financiera y construir un sistema mejor que pueda sustituirlo progresivamente**.

---

## 2. ¿Para quién es?

**Usuarios principales:**

* **Dirección / responsable financiero de Antifrágil** — importa y revisa la información mensual, resuelve incidencias, corrige clasificaciones y consulta Cash Flow y P&L.
* **Equipo técnico / CTO** — mantiene la aplicación, integraciones, Supabase, Vercel, seguridad y evolución tecnológica del proyecto.

**Posibles usuarios futuros:**

Podrán existir perfiles administrativos con permisos limitados para:

* subir documentación;
* revisar facturas pendientes;
* corregir determinadas incidencias;

pero esto NO forma parte del MVP salvo que se decida posteriormente.

---

## 3. ¿Cuál es el objetivo central?

> **Actualización de 8 de septiembre de 2026 — misión de esta etapa.**
>
> # CONCILIAR TODOS LOS MOVIMIENTOS REALES DE TESORERÍA CON SU DOCUMENTACIÓN Y PERMITIR AL USUARIO REVISAR Y CLASIFICAR LAS EXCEPCIONES DESDE UNA INTERFAZ.
>
> Esto es lo único prioritario ahora mismo. **No** son prioridad todavía: métricas
> financieras avanzadas, Cash Flow operativo, EBITDA, balances, forecasting ni la
> automatización completa de la clasificación.

A largo plazo el objetivo sigue siendo un sistema financiero mensual en el que el usuario suba los extractos, procese el mes y limite su trabajo a revisar excepciones. Pero el camino hasta ahí pasa primero por demostrar que **cada movimiento está en el ledger, con su cuenta de origen y su documento justificativo**.

### Orden de prioridad de esta etapa

1. Movimiento correcto (todos, de las tres tesorerías, una sola vez).
2. Documentación correcta (el documento que le corresponde, sea del tipo que sea).
3. Conciliación correcta (con evidencia y confianza, sin forzar nada).
4. Clasificación (categoría y P&L), que puede ser manual y asistida.

### Meses de referencia

* **Agosto 2026** ya se cerró manualmente. Se reconstruye desde cero con el motor y se **compara** contra ese cierre. Ninguna de las dos versiones se presume correcta.
* **Septiembre 2026** será el **primer periodo operativo producido por Antifrágil CFO**.

Después el mismo proceso debe funcionar para octubre y los meses siguientes sin reconstruir la lógica.

---

## 4. Stack técnico elegido

Esta decisión está CERRADA.

**Antifrágil CFO debe construirse utilizando el mismo lenguaje, stack base, arquitectura y convenciones que las aplicaciones actuales de Antifrágil desarrolladas junto al CTO, Guille Vila.**

El objetivo es que Antifrágil CFO no sea una aplicación tecnológica aislada, sino una pieza compatible con el resto del ecosistema Antifrágil.

### Repositorios técnicos de referencia

Antes de crear arquitectura nueva, Claude Code debe inspeccionar los repositorios actuales de Antifrágil disponibles localmente y en GitHub.

Actualmente se ha identificado como referencia:

`guillevila/AF-Clinic-OS`

Si localmente existe otro repositorio más específico correspondiente a la aplicación de control de entrenamiento personal, Claude Code debe inspeccionarlo también y utilizarlo como referencia prioritaria cuando represente mejor la arquitectura actual de las apps Antifrágil.

NO debe inventarse un stack diferente.

### Lenguaje

**TypeScript**

No Python.

No queremos crear una segunda tecnología backend o un entorno paralelo únicamente para las funcionalidades financieras.

La lógica financiera, importadores, conciliación, integraciones y backend deben implementarse dentro del stack TypeScript/Next.js salvo una decisión futura explícita del CTO.

### Frontend

**Next.js 15 + React 19 + TypeScript**

Utilizar:

* Next.js App Router;
* Server Components cuando sean apropiados;
* Client Components únicamente cuando sean necesarios;
* Server Actions y/o Route Handlers siguiendo las convenciones de los proyectos existentes;
* React 19.

No utilizar Pages Router para este proyecto.

### Backend

**Next.js / TypeScript + Supabase**

El backend debe seguir el mismo modelo utilizado actualmente por las aplicaciones Antifrágil.

Priorizar:

* Server Components;
* Server Actions;
* Route Handlers;
* servicios server-side;
* Supabase;
* PostgreSQL.

No crear un backend Python independiente.

No crear FastAPI.

No crear otro servidor salvo que aparezca una necesidad técnica que el stack existente no pueda resolver y el CTO lo apruebe.

### Base de datos

**Supabase / PostgreSQL**

Supabase será la fuente de datos estructurados de Antifrágil CFO.

Debe almacenar de forma protegida la información necesaria para:

* financial ledger;
* movimientos;
* periodos;
* categorías;
* P&L;
* contrapartes;
* reglas de clasificación;
* documentos;
* metadatos de Google Drive;
* conciliaciones;
* incidencias;
* importaciones;
* estados de revisión;
* auditoría;
* datos derivados necesarios.

No utilizar Google Sheets como base de datos principal de la nueva aplicación.

### Supabase SDK

Mantener el mismo patrón utilizado en el ecosistema Antifrágil:

* `@supabase/supabase-js`
* `@supabase/ssr`

Utilizar clientes separados correctamente para:

* navegador;
* servidor.

Las claves públicas pueden utilizarse según el patrón actual.

Las credenciales privilegiadas nunca deben exponerse al navegador.

### Autenticación y autorización

Utilizar:

**Supabase Auth + SSR + Row Level Security**

Mantener el patrón actual:

* sesión mediante cookies;
* validación server-side del usuario;
* RLS como última capa real de protección;
* middleware cuando sea apropiado;
* roles/permisos según las necesidades del CFO.

Nunca confiar exclusivamente en ocultar elementos de interfaz para proteger información financiera.

### UI

Mantener compatibilidad con las aplicaciones Antifrágil.

Stack de referencia actual:

* Tailwind CSS;
* Radix UI;
* Lucide React;
* utilidades existentes del ecosistema;
* componentes reutilizables cuando sea posible.

Antes de instalar una segunda librería de componentes, revisar si puede resolverse utilizando los patrones existentes.

### Validación

Utilizar:

**Zod**

para validar inputs, formularios, payloads, imports y datos externos cuando corresponda.

Los datos procedentes de:

* extractos bancarios;
* Google Drive;
* archivos;
* formularios;
* APIs externas;

deben considerarse datos no confiables hasta validarse.

### Package manager

Mantener:

**npm**

mientras siga siendo el package manager de los repositorios de referencia.

Utilizar:

`package.json`

y:

`package-lock.json`

No cambiar a pnpm, yarn o bun sin una razón aprobada.

### Hosting

**Vercel**

Antifrágil CFO debe desplegarse en Vercel y seguir las mismas convenciones del resto de aplicaciones.

Debe aprovechar correctamente:

* variables de entorno;
* previews;
* producción;
* funciones server-side;
* integración con Next.js;
* protección contra deployment skew cuando sea necesaria.

### Seguridad web

Tomar como referencia las medidas ya existentes en los proyectos Antifrágil:

* Content Security Policy;
* X-Frame-Options;
* X-Content-Type-Options;
* Referrer Policy;
* HSTS en producción;
* Permissions Policy;
* separación cliente/servidor;
* variables de entorno;
* RLS;
* autenticación server-side.

Antifrágil CFO contiene información financiera, por lo que el nivel de protección debe ser igual o superior al de las aplicaciones actuales.

### Google Drive

La integración con Google Drive debe implementarse desde el mismo backend Next.js/TypeScript.

NO crear scripts Python para recorrer Drive.

La integración debe estar encapsulada en servicios TypeScript server-side.

Conceptualmente:

`lib/google-drive/`

o siguiendo la convención equivalente que Claude encuentre en los repositorios Antifrágil.

Las credenciales de Google:

* solo server-side;
* nunca cliente;
* nunca GitHub;
* gestionadas mediante variables de entorno protegidas en Vercel.

### Procesamiento financiero

Toda la lógica de:

* parsing del extracto;
* normalización;
* matching;
* conciliación;
* clasificación;
* datáfono;
* cash;
* construcción del ledger;
* Cash Flow;
* P&L;

debe desarrollarse en:

**TypeScript**

dentro de esta misma arquitectura.

Si necesitamos procesar Excel/CSV, debe elegirse una librería compatible con Node.js/TypeScript.

Claude Code debe seleccionar la librería concreta después de inspeccionar los formatos reales.

No introducir Python únicamente porque existan librerías financieras cómodas en Python.

### Arquitectura conceptual

```text
Usuario
   ↓
Next.js / React / TypeScript
   ↓
Server Actions / Route Handlers / Server Services
   ↓
┌─────────────────────────────────────┐
│ Motor financiero TypeScript         │
│                                     │
│ Importación bancaria                │
│ Normalización                       │
│ Clasificación                       │
│ Matching                            │
│ Conciliación                        │
│ Cash                                │
│ Datáfono                            │
│ Cash Flow / P&L                     │
└─────────────────────────────────────┘
       ↓                     ↓
   Supabase              Google Drive
   PostgreSQL            Documentos
       ↓
   Financial Ledger
```

### Principio de compatibilidad

Antes de crear:

* helpers;
* clientes Supabase;
* middleware;
* auth;
* componentes;
* patrones de carpetas;
* tratamiento de errores;
* validación;
* estilos;
* funciones server-side;

Claude debe revisar cómo se ha resuelto el mismo problema en los repositorios existentes.

**Reutilizar patrones del ecosistema tiene prioridad sobre introducir una solución nueva.**

Antifrágil CFO debe sentirse técnicamente como:

> otra aplicación del mismo sistema Antifrágil

y no como:

> un proyecto independiente creado por otro equipo.

---

## 5. Decisiones cerradas ✅

Estas decisiones YA están tomadas.

Claude NO debe cuestionarlas ni reabrirlas salvo instrucción explícita del propietario del proyecto.

| ID  | Decisión                                                                                                           | Razón                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| D1  | El proyecto se llama **Antifrágil CFO**                                                                            | Será la plataforma financiera interna de Antifrágil                  |
| D2  | El lenguaje del proyecto es **TypeScript**                                                                         | Es el lenguaje de las aplicaciones Antifrágil actuales               |
| D3  | El framework base es **Next.js 15 con App Router**                                                                 | Es la arquitectura actualmente utilizada                             |
| D4  | El frontend utiliza **React 19**                                                                                   | Mantener el mismo ecosistema                                         |
| D5  | El backend utiliza **Next.js/TypeScript + Supabase**                                                               | No crear una segunda arquitectura backend                            |
| D6  | La base de datos es **Supabase/PostgreSQL**                                                                        | Infraestructura compartida y conocida                                |
| D7  | La autenticación utiliza **Supabase Auth + SSR + RLS**                                                             | Mantener el patrón de seguridad existente                            |
| D8  | El despliegue se realiza en **Vercel**                                                                             | Infraestructura estándar del ecosistema Antifrágil                   |
| D9  | El package manager inicial es **npm**                                                                              | Es el utilizado actualmente en los repositorios de referencia        |
| D10 | UI base: **Tailwind + Radix UI + Lucide**                                                                          | Mantener compatibilidad visual y técnica                             |
| D11 | Validación mediante **Zod**                                                                                        | Es la solución utilizada actualmente                                 |
| D12 | **NO se utilizará Python**                                                                                         | No queremos una arquitectura paralela                                |
| D13 | Parsers, Drive, conciliación y motor financiero se desarrollan en **TypeScript**                                   | Todo debe convivir en el mismo proyecto                              |
| D14 | Antes de crear patrones nuevos se revisan los repositorios Antifrágil existentes                                   | Mantener coherencia tecnológica                                      |
| D15 | El proyecto tendrá una aplicación web                                                                              | Queremos una herramienta operativa, no scripts manuales              |
| D16 | El antiguo `Cash Flow GEA 2026` NO tiene que seguir siendo el documento maestro                                    | Queremos sustituir progresivamente el Excel                          |
| D17 | `Cash Flow GEA 2026` se utiliza como fuente histórica y especificación de lógica financiera hasta julio de 2026    | Contiene el modelo que ya utiliza el negocio                         |
| D18 | La lógica financiera histórica debe conservarse al migrarla                                                        | No queremos reinventar arbitrariamente categorías y P&L              |
| D19 | El sistema tendrá un **financial ledger central**                                                                  | Banco, cash, ingresos, documentación y clasificación deben converger |
| D20 | Cash Flow será una vista calculada sobre ese ledger                                                                | Evitar varios sistemas manuales desconectados                        |
| D21 | Google Drive seguirá siendo el repositorio documental principal de facturas                                        | Ya contiene la documentación organizada                              |
| D22 | Supabase almacenará principalmente datos y metadatos de documentos, no necesariamente copias de todas las facturas | Evitar duplicaciones innecesarias                                    |
| D23 | La aplicación accederá a Drive programáticamente                                                                   | No depender de búsquedas manuales de Claude                          |
| D24 | Drive debe navegarse por Año → Trimestre → Tipo de documento → Mes                                                  | Evitar escanear todo Drive                                           |
| D25 | El extracto bancario se podrá subir inicialmente desde la aplicación                                                | Es suficiente para el MVP                                            |
| D26 | Las importaciones deben ser idempotentes                                                                           | Repetir una importación no puede duplicar movimientos                |
| D27 | Los documentos de Drive también deben sincronizarse de forma idempotente                                           | Evitar duplicados                                                    |
| D28 | Los nuevos movimientos deben clasificarse siguiendo las reglas históricas existentes                               | Mantener la lógica financiera                                        |
| D29 | La clasificación automática inicial será determinista y basada en reglas                                           | Evitar decisiones financieras opacas                                 |
| D30 | Las correcciones manuales pueden convertirse en reglas futuras                                                     | Reducir intervención con el tiempo                                   |
| D31 | Si una clasificación no es suficientemente segura debe quedar pendiente de revisión                                | Mejor no clasificar que hacerlo mal                                  |
| D32 | Los movimientos de datáfono se concilian por suma mensual                                                          | El banco agrupa operaciones                                          |
| D33 | `LIQUIDACIÓN DE REMESAS DE COMERCIO` identifica los cobros de datáfono de clínica                                  | Regla operativa conocida                                             |
| D34 | Ventas clínica banco y liquidaciones datáfono representan el mismo ingreso                                         | Evitar doble contabilización                                         |
| D35 | Los ingresos cash de clínica proceden del documento de ventas/facturación cash                                     | Es la fuente económica correcta                                      |
| D36 | Una retirada de caja NO es un ingreso económico                                                                    | Es un movimiento interno de tesorería                                |
| D37 | Transferencias internas y movimientos entre cajas no crean ingresos ni gastos                                      | Evitar doble contabilización                                         |
| D38 | Las facturas deben contrastarse en ambas direcciones: movimiento → factura y factura → movimiento                   | Detectar faltantes y no pagadas                                      |
| D39 | Una factura sin movimiento NO debe crear automáticamente un gasto                                                  | Puede estar pendiente o pagada en otro momento                       |
| D40 | Un ingreso bancario no datáfono sin documentación debe generar una incidencia                                      | Control documental de ingresos                                       |
| D41 | Los balances NO forman parte del objetivo inicial                                                                  | Primero ledger y Cash Flow fiables                                   |
| D42 | Agosto 2026 es el mes piloto del MVP                                                                               | Primer mes de funcionamiento completo                                |
| D43 | Enero-julio 2026 deberán poder migrarse posteriormente al nuevo sistema                                            | Conservar histórico                                                  |
| D44 | El repositorio puede ser público para permitir revisión externa del código                                         | Facilitar colaboración técnica                                       |
| D45 | Ningún dato financiero sensible debe publicarse en GitHub                                                          | Seguridad                                                            |
| D46 | Secrets, credenciales y claves se gestionan mediante variables protegidas                                          | Seguridad                                                            |
| D47 | Supabase debe tener RLS desde el principio                                                                         | Información financiera sensible                                      |
| D48 | Service Role nunca debe exponerse en cliente                                                                       | Seguridad                                                            |
| D49 | Toda operación financiera importante debe ser trazable hasta su fuente                                             | Auditoría                                                            |
| D50 | El sistema debe conservar historial de importaciones y cambios relevantes                                          | Evitar modificaciones silenciosas                                    |
| D51 | Cada cambio importante de código debe terminar con tests, lint, typecheck y build                                  | Evitar regresiones                                                   |
| D52 | No se construirán funcionalidades decorativas antes de que el motor financiero funcione                            | Priorizar funcionalidad                                              |
| D53 | Exactitud financiera tiene prioridad sobre automatización y estética                                               | Principio fundamental                                                |

### Decisiones añadidas el 8 de septiembre de 2026

| ID  | Decisión                                                                                                              | Razón                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D54 | La misión de esta etapa es **conciliar movimientos con documentación y revisar excepciones desde una interfaz**       | Es lo que hoy consume el trabajo manual                                     |
| D55 | Se procesan **tres tesorerías**: banco SL, banco SC y caja                                                            | Toda la actividad económica pasa por ellas                                  |
| D56 | Todas convergen en un único ledger, pero **cada movimiento conserva su cuenta de origen**                             | Hay que poder cuadrar cada tesorería por separado                           |
| D57 | El concepto es **documento justificativo**, no solo factura: nóminas, impuestos, Seguridad Social, recibos, ventas    | No todo gasto tiene factura, y no por eso está injustificado                |
| D58 | Existe el estado **`not_document_required`** como estado FINAL legítimo                                               | Una comisión bancaria no tendrá factura nunca; tratarla como falta es ruido |
| D59 | Estados de conciliación: `pending`, `reconciled`, `missing_document`, `ambiguous`, `not_document_required`            | Cubren los casos reales sin ambigüedad                                      |
| D60 | El motor consulta un **índice documental en Supabase**, nunca recorre Drive en cada ejecución                          | Rápido, reproducible y auditable                                            |
| D61 | La sincronización con Drive navega **solo la rama del periodo** y es idempotente (clave: `drive_file_id`)             | Evita escanear todo Drive y duplicar documentos                             |
| D62 | El matching soporta 1↔1, 1↔N, N↔1 y agregados de periodo, y **guarda método, confianza y motivos**                    | Una nómina puede pagarse en dos cargos; un pago liquidar varias facturas    |
| D63 | La clasificación puede quedar pendiente y resolverse **desde la interfaz**, con opción de guardar la decisión como regla | Reduce intervención con el tiempo sin decisiones opacas                     |
| D64 | **Agosto 2026 es referencia, no verdad infalible.** Se reconstruye y se compara                                       | El cierre manual también puede contener errores                             |
| D65 | Toda diferencia con el cierre manual nace como `pending` y la clasifica una persona                                   | Ni el motor ni el histórico se presumen correctos                           |
| D66 | **Nunca** se ajusta el algoritmo para reproducir un posible error histórico                                           | Primero entender la causa; solo cambiar el motor si el equivocado es él     |
| D67 | **Septiembre 2026** es el primer periodo operativo producido por la aplicación                                        | Objetivo operativo inmediato                                                |
| D68 | Las métricas del MVP se limitan a: ingresos, gastos, flujo neto, por tesorería, % conciliado, nº pendientes, importe pendiente de justificar, gastos por categoría y por P&L | Todo lo demás distrae de la misión actual |
| D69 | Cash Flow operativo, EBITDA, balances y reporting avanzado se deciden **después**                                     | No condicionan la arquitectura y hoy no aportan                             |

---

## 6. Decisiones abiertas ❓

Actualmente **no existe ninguna decisión de negocio que deba bloquear el inicio del proyecto**.

Existen decisiones técnicas que Claude debe resolver mediante discovery y propuesta técnica.

| ID | Pregunta                                                                                                                          | Quién decide                                 | Momento                   |
| -- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- |
| O1 | Método definitivo de autenticación con Google Drive: OAuth, Service Account u otra solución compatible con infraestructura actual | Claude propone / CTO valida                  | Antes de producción       |
| O2 | Formato exacto del primer parser bancario según el archivo BBVA real                                                              | Se determina inspeccionando el extracto real | Fase importación bancaria |
| O3 | Momento exacto de migración enero-julio 2026                                                                                      | Propietario del proyecto                     | Después de validar agosto |
| O4 | Nivel futuro de permisos para usuarios administrativos adicionales                                                                | Propietario del proyecto                     | Después del MVP           |

Ninguna de estas decisiones debe impedir crear el proyecto, modelo inicial, seguridad, interfaz base o arquitectura.

---

## 7. Lo que NO es este proyecto

Antifrágil CFO:

* NO es un ERP completo.
* NO es un programa de contabilidad fiscal.
* NO sustituye a la gestoría.
* NO presenta impuestos.
* NO es una aplicación de nóminas.
* NO intenta automatizar inicialmente todos los procesos administrativos.
* NO necesita construir balances en el MVP.
* NO necesita forecasting en el MVP.
* NO necesita presupuestos en el MVP.
* NO necesita tesorería predictiva en el MVP.
* NO necesita conexión bancaria automática en el MVP.
* NO debe utilizar IA para inventar clasificaciones financieras.
* NO es simplemente una nueva versión visual del Excel.
* NO depende permanentemente de Google Sheets.
* NO debe modificar los documentos históricos originales de Drive.
* NO debe guardar secretos en GitHub.
* NO debe almacenar datos financieros sensibles en repositorios públicos.
* NO debe construir una interfaz compleja antes de que la lógica financiera funcione.
* NO debe utilizar Python como stack paralelo.
* NO debe intentar resolver ahora funcionalidades futuras solo porque puedan ser útiles algún día.

---

## 8. Fases del proyecto

Reordenadas el 8 de septiembre de 2026 según la misión de conciliación.

| Fase                                    | Qué incluye                                                                                          | Estado          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------- |
| Fase 0 — Discovery técnico              | Repositorios Antifrágil, stack, convenciones, Supabase, Vercel, auth y estructura                     | ✅ Completada    |
| Fase 1 — Fundación                      | Repo, aplicación, migraciones, RLS, estructura y documentación                                        | ✅ Completada    |
| Fase 2 — Modelo multi-cuenta            | Banco SL, banco SC y caja convergiendo en un ledger, cada apunte con su cuenta                        | ✅ Completada    |
| Fase 3 — Motor de conciliación          | Documento justificativo, 4 cardinalidades de matching, evidencia, `not_document_required`             | ✅ Completada    |
| Fase 4 — Cola de excepciones            | Movimientos sin documento, documentos sin movimiento, ambiguos, sin clasificar, datáfono              | ✅ Completada    |
| Fase 5 — Interfaz operativa (lectura)   | Movimientos por cuenta, estado documental, cola de revisión y métricas del MVP                        | ✅ Completada    |
| Fase 6 — Índice documental Drive        | Navegación acotada al periodo, indexación idempotente y metadatos                                     | 🟡 Motor listo; falta credencial y persistencia |
| Fase 7 — Persistencia en Supabase       | Aplicar migración, upsert idempotente del ledger, documentos e incidencias                            | ⬜ Siguiente     |
| Fase 8 — Clasificación desde la interfaz| Elegir categoría y P&L, y "guardar esta decisión como regla"                                          | ⬜ Siguiente     |
| Fase 9 — Reconstrucción de agosto 2026  | Reconstruir el mes y compararlo con el cierre manual, clasificando cada diferencia                    | 🟡 Motor listo; faltan los archivos reales |
| Fase 10 — Septiembre 2026 operativo     | Primer periodo producido íntegramente por Antifrágil CFO                                              | ⬜ Objetivo      |
| Fase 11 — Automatización mensual        | Cierre reducido a importar y revisar excepciones                                                      | ⬜ Pendiente     |
| Fase 12 — Migración histórica           | Incorporar enero-julio 2026                                                                           | ⬜ Pendiente     |
| Futuro                                  | Cash Flow operativo, EBITDA, balances, presupuestos, forecasting y reporting                          | ⬜ Fuera del MVP |

> "Completada" significa: implementado y cubierto por tests con datos sintéticos.
> La validación definitiva llega con los documentos reales de agosto y septiembre.

---

## 9. Contexto de negocio relevante

### 9.1 Situación actual

La gestión financiera mensual se apoya actualmente en varios elementos separados:

* extracto bancario;
* Google Drive;
* facturas de gastos;
* facturas/documentos de ingresos;
* `Cash Flow GEA 2026`;
* `Cuenta de cash Antifrágil`;
* documentos de ventas de clínica banco;
* documentos de ventas de clínica cash.

Existe demasiada intervención manual para cruzar toda esta información.

Antifrágil CFO debe convertir este proceso en un sistema.

---

### 9.2 Google Drive

Carpeta financiera principal:

`https://drive.google.com/drive/folders/1xrSv3X_BYzB8DwUhb7_mxCQtO_t9c-R4?usp=drive_link`

La estructura se organiza por:

**Año → Trimestre → Tipo de documento → Mes**

Para agosto 2026:

```text
2026
└── DocumentaciónAF-Q32026
    └── 2. Facturas
        └── 5. Agosto
```

Dentro de la carpeta mensual existen:

* facturas de gastos;
* documentos justificativos;
* facturas/ventas de ingresos;
* Excels de ventas;
* otros documentos financieros.

Ejemplo existente:

`I_Ventas Clínica Banco Agosto 26 (5025)`

El sistema debe ir directamente a la carpeta del periodo correspondiente.

NO debe recorrer indiscriminadamente todo Google Drive.

---

### 9.3 Convenciones documentales

Actualmente muchos documentos siguen una nomenclatura que ayuda a identificar su naturaleza:

* `G_...` suele corresponder a gasto.
* `I_...` suele corresponder a ingreso.

Esto puede utilizarse como señal auxiliar.

NO debe ser la única regla de identificación.

También deben utilizarse:

* metadata;
* periodo;
* nombre;
* importe;
* contraparte;
* contenido cuando sea necesario.

---

### 9.4 Cash Flow histórico

Documento:

**Cash Flow GEA 2026**

Google Sheet ID:

`1pijqQNRvLAOVUaMXlYytVxHOmNy0uf4eUO7ty9bXTb4`

Contiene actualmente:

* 2026;
* ENERO;
* FEBRERO;
* MARZO;
* Q1;
* ABRIL;
* MAYO;
* JUNIO;
* JULIO.

JULIO es la principal referencia inmediata para comenzar agosto.

La aplicación NO necesita replicar visualmente este documento.

Debe replicar y mejorar:

**su lógica de negocio.**

---

### 9.5 Modelo de gastos histórico

En el Cash Flow actual cada gasto contiene conceptualmente:

* Nº asiento;
* nombre/descripción;
* categoría;
* P&L;
* factura sí/no;
* tesorería Banco/Cash;
* monto;
* referencia documental.

Existen agregaciones por:

* Categoría.
* P&L.
* Tesorería.
* Factura Sí/No.

---

### 9.6 Categorías existentes

Existen categorías históricas como:

* Fisioterapeutas
* Entrenadores
* Nutricionistas
* Impuestos
* Reuniones
* Materiales Clínica
* Alquiler
* Limpieza
* Marketing
* Gestión
* Recursos Digitales
* Reforma Clínica
* Cens
* 9 AM

Estas son ejemplos confirmados.

Claude debe analizar todos los meses históricos para obtener la taxonomía completa antes de crear una migración definitiva.

---

### 9.7 P&L histórico

Existen clasificaciones como:

* COGS
* Personal Directo
* Personal Estructura
* Opex Directo
* Opex Estructura
* Impuestos
* Capex

Claude debe obtener la taxonomía definitiva del histórico.

---

### 9.8 Clasificación recurrente

Muchos movimientos son recurrentes.

Ejemplo conceptual:

```text
OPENAI / CHATGPT
↓
Recursos Digitales
↓
Opex Estructura
```

Otro:

```text
SALONIZED
↓
Recursos Digitales
↓
Opex Estructura
```

Estas relaciones deben convertirse en:

**reglas explícitas de clasificación.**

Las reglas deben ser:

* auditables;
* editables;
* activables/desactivables;
* trazables;
* aplicables automáticamente en meses posteriores.

---

### 9.9 Corrección y aprendizaje

Cuando aparezca un concepto nuevo:

1. el sistema intenta clasificarlo por reglas existentes;
2. si existe alta confianza, aplica la regla;
3. si no existe regla segura, queda pendiente;
4. el usuario clasifica manualmente;
5. opcionalmente se crea una nueva regla;
6. meses posteriores utilizan esa regla.

No se necesita Machine Learning para esto.

---

### 9.10 Cuenta de cash

Documento:

**Cuenta de cash Antifrágil**

Google Sheet ID:

`1sRWgV6Gg0x6T6bCId6V3EVD_OQ2ZTeDdMzo0XqH0Cx8`

Tiene pestañas mensuales.

Para agosto:

**AGOSTO 26**

Actualmente existen ejemplos como:

* Carlos Velasco Entrenamiento → Personal Directo.
* Extra Moreno → Personal Directo.
* Marta Marcos Nutrición → Personal Directo.

Estos son gastos empresariales reales pagados mediante cash.

Deben incorporarse al ledger con:

`treasury = cash`

---

### 9.11 Movimientos internos de cash

Dentro de `Cuenta de cash Antifrágil` también aparecen:

**Retirada de caja**

Estas operaciones:

NO son ingresos.

Representan transferencias internas de tesorería.

Del mismo modo NO son actividad económica:

* cantidad inicial;
* transferencias entre cajas;
* retirada de caja;
* ingreso de una caja en otra;
* movimientos internos equivalentes.

El ledger puede registrarlos como movimientos internos si técnicamente resulta útil.

Pero:

**NO pueden incrementar ingresos ni gastos del P&L.**

---

### 9.12 Importación bancaria

En la primera versión el usuario subirá manualmente el extracto mensual.

La aplicación deberá:

1. recibir archivo;
2. detectar/validar formato;
3. mostrar preview;
4. normalizar movimientos;
5. generar identificador estable/hash;
6. comprobar duplicados;
7. importar.

Cada transacción debe conservar el dato original.

Como mínimo:

* fecha;
* fecha valor;
* concepto original;
* descripción;
* importe;
* dirección ingreso/gasto;
* tesorería;
* contraparte;
* fuente;
* periodo;
* clasificación;
* documentación;
* estado de conciliación;
* estado de revisión.

---

### 9.13 Gastos banco → facturas

Para cada gasto bancario el sistema debe buscar su factura.

Matching utilizando:

* importe;
* proveedor;
* fecha;
* razón social;
* número de factura;
* concepto;
* otras señales disponibles.

Si encuentra correspondencia:

`CONCILIADO`

Si debería existir factura pero no aparece:

`FACTURA FALTANTE`

Si existen varias posibilidades:

`REVISAR`

Nunca forzar asociaciones.

---

### 9.14 Facturas → movimientos

También debe realizarse el proceso inverso.

Por cada factura del mes:

buscar:

* movimiento bancario;
* o gasto cash.

Si no existe correspondencia:

`FACTURA SIN MOVIMIENTO`

La factura NO debe convertirse automáticamente en gasto.

Puede significar:

* pendiente de pago;
* pagada en otro mes;
* pagada por otra vía;
* error documental;
* error de conciliación.

---

### 9.15 Ingresos normales de banco

Los ingresos bancarios que NO sean datáfono deben revisarse individualmente.

Para cada uno:

* importe;
* origen;
* categoría;
* documento/factura;
* conciliación.

Si no existe documentación:

`INGRESO SIN FACTURA`

---

### 9.16 Datáfono de clínica

Todos los movimientos bancarios equivalentes a:

`LIQUIDACIÓN DE REMESAS DE COMERCIO`

corresponden a cobros de datáfono de clínica.

NO deben conciliarse individualmente con cada factura.

Se utiliza conciliación agregada mensual.

### Banco

```text
TOTAL_DATÁFONO_BANCO
=
SUMA de todas las liquidaciones de remesas de comercio del mes
```

### Facturación

Localizar en Drive el Excel mensual equivalente a:

`I_Ventas Clínica Banco [Mes] [Año]`

Calcular:

```text
TOTAL_FACTURACIÓN_CLÍNICA_BANCO
```

### Conciliación

```text
DIFERENCIA
=
TOTAL_DATÁFONO_BANCO
-
TOTAL_FACTURACIÓN_CLÍNICA_BANCO
```

Si:

`DIFERENCIA = 0`

→ Conciliado.

Si:

`DIFERENCIA != 0`

→ Incidencia.

Nunca cambiar importes para hacerlos coincidir.

---

### 9.17 Ingresos clínica cash

La fuente del ingreso cash de clínica es:

**el documento/Excel de ventas de clínica cobradas en cash.**

NO:

`Cuenta de cash → Retiradas de caja`

El total de ventas cash constituye ingreso.

La posterior retirada o movimiento físico de ese dinero constituye únicamente tesorería.

---

### 9.18 Doble contabilización

Es una regla crítica del sistema.

### Datáfono

```text
Liquidaciones banco
+
Facturas individuales
```

NO son dos ingresos.

Representan el mismo ingreso.

### Cash

```text
Ventas cash
+
Retirada de caja
```

NO son dos ingresos.

### Gastos

```text
Movimiento bancario
+
Factura asociada
```

NO son dos gastos.

El ledger debe representar una única realidad económica con diferentes fuentes/documentos asociados.

---

### 9.19 Financial Ledger

El núcleo de la nueva aplicación debe ser un:

# FINANCIAL LEDGER

Debe actuar como fuente central de la realidad financiera.

Conceptualmente puede contener:

* periodo;
* transacción;
* fecha;
* tipo;
* ingreso/gasto/movimiento interno;
* tesorería;
* contraparte;
* categoría;
* P&L;
* importe;
* fuente;
* documento;
* conciliación;
* revisión;
* auditoría.

El modelo técnico definitivo lo decide Claude después de estudiar:

* el histórico;
* los repositorios Antifrágil;
* las necesidades reales.

No crear tablas innecesarias solo porque aparecen aquí como conceptos.

---

### 9.20 Supabase

Supabase puede almacenar:

* periodos;
* movimientos;
* contrapartes;
* categorías;
* P&L;
* reglas;
* documentos;
* conciliaciones;
* incidencias;
* importaciones;
* eventos de auditoría;
* resultados calculados cuando sea útil.

La normalización exacta debe encontrar equilibrio entre:

**simplicidad + integridad + evolución futura.**

---

### 9.21 Google Drive y Supabase

Drive seguirá manteniendo los archivos originales.

Supabase puede almacenar:

* Drive File ID;
* nombre;
* enlace;
* tipo;
* proveedor;
* número factura;
* fecha;
* importe;
* periodo;
* estado;
* hash/identificador;
* metadata necesaria.

No necesitamos copiar automáticamente todas las facturas a Supabase Storage si no existe una ventaja clara.

---

### 9.22 Seguridad

Toda información financiera es privada.

Debe existir:

* autenticación;
* RLS;
* autorización;
* separación cliente/servidor;
* validación de inputs;
* secrets solo server-side;
* logs seguros;
* auditoría.

Nunca:

* Service Role en cliente;
* secrets en Git;
* tokens en código;
* datos bancarios en repositorio público;
* facturas en repositorio público.

---

### 9.23 GitHub

El repositorio:

`antifragil-cfo`

puede ser público para facilitar revisión del código por:

* CTO;
* Claude Code;
* ChatGPT;
* colaboradores técnicos autorizados.

Pero únicamente contendrá:

* código;
* documentación;
* migraciones;
* tests;
* fixtures sintéticos;
* configuración no sensible.

NO contendrá información financiera real.

---

### 9.24 Cash Flow dentro de la aplicación

Cash Flow será una vista del ledger.

Debe permitir consultar por mes:

### Gastos

* asiento;
* gasto;
* categoría;
* P&L;
* factura;
* tesorería;
* importe;
* documento.

### Ingresos

* asiento;
* ingreso;
* categoría;
* importe;
* documentación.

### Agregaciones

* categoría;
* P&L;
* banco/cash;
* facturas sí/no;
* ingresos;
* gastos.

Posteriormente:

* margen de contribución;
* EBITDA;
* Cash Flow;

siguiendo la lógica histórica validada.

---

### 9.25 Balances

Los balances son secundarios.

No deben condicionar la primera arquitectura de forma que compliquen innecesariamente el MVP.

Primero:

* ledger;
* conciliación;
* clasificación;
* ingresos;
* gastos;
* Cash Flow;
* P&L.

Después:

* balances;
* reporting avanzado;
* forecasting;
* presupuestos.

---

### 9.26 Flujo mensual ideal

El flujo objetivo es:

### 1.

El usuario entra en Antifrágil CFO.

### 2.

Selecciona:

`Agosto 2026`

### 3.

Sube el extracto bancario.

### 4.

Pulsa:

`Procesar mes`

### 5.

El sistema:

* importa banco;
* normaliza movimientos;
* aplica reglas conocidas;
* sincroniza carpeta Drive del periodo;
* indexa facturas;
* cruza banco ↔ facturas;
* cruza facturas ↔ movimientos;
* identifica ingresos;
* concilia datáfono;
* obtiene ventas cash;
* importa gastos cash;
* excluye movimientos internos;
* genera incidencias;
* calcula Cash Flow.

### 6.

El usuario revisa únicamente excepciones.

### 7.

Corrige cuando sea necesario.

### 8.

Las correcciones pueden generar reglas futuras.

### 9.

El periodo queda:

`REVISADO / CERRADO`

---

### 9.27 Estados

El sistema debe diferenciar estados conceptualmente similares a:

### Importaciones

* uploaded
* processing
* processed
* failed

### Movimientos

* imported
* needs_review
* reviewed
* approved

### Conciliación

* matched
* missing_document
* ambiguous
* unmatched

### Periodos

* open
* processing
* review
* closed

Los nombres técnicos definitivos pueden cambiar.

Lo importante es evitar cambios financieros silenciosos.

---

### 9.28 Auditoría

Debe poder responderse siempre:

> ¿Por qué existe esta cifra?

Ejemplo:

```text
Movimiento:
OPENAI — 21,83 €

Fuente:
Extracto BBVA Agosto 2026

Clasificación:
Recursos Digitales

P&L:
Opex Estructura

Motivo:
Regla histórica CHATGPT

Documento:
G_Chat GPT Agosto 26.pdf

Drive File ID:
...

Conciliación:
Matched

Importación:
...

Última modificación:
...
```

---

### 9.29 Calidad del desarrollo

Después de cualquier modificación relevante:

1. ejecutar tests;
2. lint;
3. typecheck;
4. build;
5. comprobar consola;
6. ejecutar smoke tests de flujos relevantes;
7. comprobar regresiones;
8. comprobar performance razonable.

Una tarea NO está terminada simplemente porque compile.

Regla:

# Cada modificación debe dejar la aplicación al menos tan estable como estaba antes.

---

## 10. Métricas de éxito

### MVP de conciliación (criterio vigente desde el 8 de septiembre de 2026)

El MVP estará conseguido cuando, para un mes completo:

* Los movimientos de las **tres tesorerías** (banco SL, banco SC y caja) están en el ledger una sola vez y cada uno conserva su cuenta.
* Cada movimiento tiene un estado documental explícito: `reconciled`, `missing_document`, `ambiguous` o `not_document_required`.
* Cada asociación automática guarda **método, confianza y motivos**.
* Los documentos de Drive del periodo están indexados y consultables sin recorrer todo Drive.
* Los documentos sin movimiento están identificados y **no** se han convertido en gasto.
* El datáfono está conciliado por suma mensual, o su diferencia está reportada sin ajustar.
* La cola de revisión contiene exactamente las excepciones, y nada más.
* El usuario puede ver todo eso en la interfaz y clasificar lo que falte.
* Reprocesar el mes no duplica nada.

### Métricas del MVP (y solo estas)

Ingresos totales · gastos totales · flujo neto de caja · movimientos y neto por tesorería ·
% de movimientos conciliados · nº de movimientos pendientes · importe pendiente de justificar ·
gastos por categoría · gastos por P&L.

### Comprobaciones heredadas (agosto 2026)

Siguen siendo válidas al reconstruir agosto y compararlo con el cierre manual:

* El 100% de movimientos del extracto quedan importados una sola vez.
* Reimportar el mismo extracto no genera duplicados.
* El 100% de movimientos mantiene trazabilidad hasta su fuente.
* Los gastos recurrentes conocidos reciben correctamente su clasificación histórica.
* Las clasificaciones dudosas se muestran para revisión en lugar de inventarse.
* Las correcciones pueden convertirse en reglas reutilizables.
* Se indexan correctamente las facturas del mes desde Drive.
* Los gastos con factura quedan asociados correctamente.
* Los gastos sin factura quedan claramente identificados.
* Las facturas sin movimiento quedan claramente identificadas.
* Los ingresos normales sin documentación quedan claramente identificados.
* Todas las liquidaciones de datáfono del mes quedan detectadas.
* El total datáfono se compara correctamente contra las ventas banco.
* Una diferencia de datáfono nunca se oculta ni corrige artificialmente.
* Los ingresos cash de clínica se obtienen de la fuente correcta.
* Las retiradas de caja no se contabilizan como ingreso.
* Los gastos cash reales sí aparecen en el ledger.
* No existe doble contabilización banco/factura.
* No existe doble contabilización ventas cash/retirada.
* Cash Flow de agosto puede generarse desde el ledger.
* P&L de agosto mantiene la lógica histórica.
* Todas las incidencias pueden revisarse desde la aplicación.
* Todos los datos financieros están protegidos.
* RLS está habilitado y validado.
* Ningún secret se expone en cliente o GitHub.
* Tests, lint, typecheck y build están en verde.

### Objetivo operativo

El objetivo final es que el cierre financiero mensual pase de ser un trabajo manual de búsqueda y copia a un proceso basado fundamentalmente en:

**procesar → revisar excepciones → aprobar.**

---

*Última actualización: 8 de septiembre de 2026 — reorientación a la misión de conciliación (D54-D69).*
