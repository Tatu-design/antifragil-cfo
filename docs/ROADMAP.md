# Roadmap

Estado a 3 de septiembre de 2026.

---

## ✅ Hecho — Fase 0 y fundación

- **Discovery técnico**: inspeccionados los repositorios Antifrágil locales (`App Lidomare`, `antifragil-portal`) para heredar stack, estructura, patrones Supabase y convenciones.
- **Proyecto creado**: Next.js 16 + React 19 + TypeScript + Tailwind v4, `.gitignore` endurecido antes del primer commit.
- **Motor financiero completo y testeado**: dinero en céntimos, fechas ISO, movimientos internos, datáfono, conciliación bidireccional, incidencias, clasificación por reglas, idempotencia y Cash Flow como vista.
- **Lectura de fuentes**: XLSX/CSV con detección de cabeceras por sinónimos, sin posiciones fijas de celda.
- **CLI**: `inspect`, `analyze`, `demo`. Ninguno escribe en documentos reales.
- **Informes de auditoría**: inspección, conciliación, incidencias y resumen con Cash Flow.
- **Esquema Supabase** con RLS en todas las tablas, sin políticas de DELETE y con las reglas financieras como restricciones CHECK.
- **Documentación**: visión, reglas financieras, arquitectura, modelo de datos y runbook.
- **40 tests** en verde, todos con datos sintéticos.

---

## ⏭️ Siguiente — Agosto 2026 con documentos reales

### 1. Inspección (sin tocar nada)
Ejecutar `inspect 2026-08` sobre los documentos reales y revisar el informe:
¿se reconocen las cabeceras del extracto BBVA? ¿la pestaña `AGOSTO 26` de la cuenta
de cash? ¿los Excels de ventas? Ajustar sinónimos de columna donde haga falta (O2).

### 2. Modelo financiero histórico (Fase 2)
Estudiar `Cash Flow GEA 2026`, especialmente **julio**: estructura, categorías,
taxonomía de P&L, agregaciones y cálculos. Extraer la taxonomía completa y
proponerla para validación. **No se inventa ninguna categoría.**

### 3. Catálogo de reglas
Con la taxonomía validada, convertir las clasificaciones recurrentes del histórico
en reglas explícitas, auditables y trazables. Cada regla con su motivo escrito.

### 4. Facturas reales
Decidir cómo indexar las facturas PDF (nombre, contenido o índice) para que el
matching por importe funcione. Hoy los PDF se registran como documentos pendientes
en lugar de inventarles cifras.

### 5. Persistencia en Supabase
Crear el proyecto, aplicar la migración, dar de alta miembros y validar RLS con un
usuario real. Escritura idempotente por upsert sobre ids deterministas.

### 6. Cierre de agosto (Fase 10)
Cash Flow de agosto generado desde el ledger, revisado y aprobado. Es el criterio
de éxito del MVP.

---

## Después

| Fase | Contenido |
|------|-----------|
| Google Drive (Fase 6) | Navegación Año → Trimestre → Tipo → Mes. Nunca escanear todo Drive. Decidir método de autenticación (O1) |
| Interfaz operativa (Fase 11) | Elegir mes, procesar, revisar incidencias, aprobar. Solo cuando el motor esté validado |
| Migración histórica (Fase 12) | Enero–julio 2026 al nuevo sistema (O3) |
| Automatización mensual (Fase 13) | Cierre reducido a importar y revisar excepciones |
| Fuera del MVP | Balances, presupuestos, forecasting, reporting avanzado |

---

## Decisiones abiertas

| ID | Pregunta | Quién decide |
|----|----------|--------------|
| O1 | Autenticación con Google Drive: OAuth vs Service Account | Claude propone / CTO valida |
| O2 | Formato exacto del parser bancario BBVA | Se determina inspeccionando el extracto real |
| O3 | Cuándo migrar enero–julio 2026 | Propietario |
| O4 | Permisos de usuarios administrativos adicionales | Propietario |

### Supuesto pendiente de confirmar con el histórico

La línea consolidada de datáfono reconoce el **importe cobrado en banco**. Si al
inspeccionar julio resulta que el criterio histórico es reconocer la facturación,
se cambia la regla, su test y `FINANCIAL_RULES.md`.
