# Seguridad

Cómo se protege la información financiera y por qué está así.

---

## Auditoría del 15 de septiembre de 2026

Antes de esta fase, la documentación afirmaba que las operaciones validaban la
sesión. **No era cierto.** Estos fueron los hallazgos, todos corregidos:

| # | Hallazgo | Gravedad | Estado |
|---|----------|----------|--------|
| 1 | Ninguno de los 4 Route Handlers comprobaba la sesión. Cualquiera con la URL podía subir, procesar, listar y descargar documentos | **Crítica** | Corregido: `guardApi()` es la primera línea de los 4 |
| 2 | El `matcher` del middleware excluía explícitamente `/api`, así que las rutas de datos no pasaban por él | **Crítica** | Corregido: el matcher solo excluye estáticos |
| 3 | No existía página de login ni flujo de sesión. El middleware redirigía a `/login`, que no existía | **Crítica** | Corregido: `/login` con Supabase Auth |
| 4 | Sin variables de entorno, el middleware "dejaba pasar todo" (fail-open) | **Alta** | Corregido: fail-closed; el modo local exige variable explícita y no-producción |
| 5 | Los clientes de sesión (`lib/supabase/{client,server}.ts`) estaban escritos pero no los usaba nadie | **Alta** | Corregido: son el camino normal de toda la aplicación |
| 6 | El único uso de Supabase era Storage, y con `service_role`, saltándose RLS | **Alta** | Corregido: la operativa usa el cliente de sesión |
| 7 | Todo el estado vivía en JSON en disco. En Vercel se pierde en cada redeploy | **Alta** | Corregido: PostgreSQL es la fuente de verdad |
| 8 | Comentarios que afirmaban validaciones inexistentes | Media | Corregidos |

---

## Capas de defensa

Son cuatro, y cada una funciona sola:

```text
1. Middleware (proxy.ts)      Sin sesión → API 401, páginas → /login
2. Guard de servidor          guardApi() / authorize() en cada ruta y página
3. RLS en PostgreSQL          Cada consulta viaja como el usuario; sin fila en
                              cfo_members, cero filas en todas partes
4. Políticas de Storage       El bucket es privado; solo miembros pueden leerlo
```

La interfaz **no** es una capa de seguridad. Ocultar un botón no autoriza nada.

---

## Autorización

Estar autenticado no basta. Hacen falta dos cosas:

1. Sesión válida de Supabase Auth, verificada con `getUser()` — nunca con
   `getSession()`, cuyo contenido sale de la cookie y es manipulable.
2. Una fila en `cfo_members`. Un usuario nuevo del proyecto no obtiene acceso
   automático a nada.

Roles: `owner` y `editor` pueden escribir; `viewer` solo lee. Las operaciones de
escritura piden `guardApi({ write: true })`.

**Por qué lista blanca y no `owner_user_id`:** los datos son de la empresa, no de
una persona. Todos los miembros ven lo mismo, que es el comportamiento correcto
para un equipo financiero. Es el patrón más simple que cumple el requisito de que
un usuario futuro no obtenga acceso por el mero hecho de existir, y admite añadir
usuarios sin rehacer la seguridad.

---

## Uso de `service_role`

Se usa en **un único sitio**: [scripts/bootstrap-member.ts](../scripts/bootstrap-member.ts),
para dar de alta al primer miembro. Es la única operación que RLS no permite por
diseño (si el cliente pudiera escribir en `cfo_members`, cualquiera se
autorizaría a sí mismo).

Todo lo demás —subir, leer, procesar, persistir— usa el cliente de sesión, de
forma que **RLS es la barrera real** y no depende de que el código recuerde
filtrar. Un test comprueba que `createAdminClient` no aparece en `lib/`.

Nunca: en cliente, con prefijo `NEXT_PUBLIC_`, en logs, en respuestas de error ni
en Git.

---

## Documentos

- Bucket **privado**. No hay URLs públicas: un test verifica que `getPublicUrl` no aparece en el código.
- El acceso pasa por `/api/documentos/...`, que **primero** autoriza y luego firma una URL de 5 minutos (o sirve el archivo en modo local).
- Conocer la ruta o el SHA-256 de un documento **no** da acceso.
- `Cache-Control: private, no-store` en la respuesta.
- Los errores devuelven un mensaje genérico; el detalle queda en el log del servidor.

---

## Idempotencia garantizada por la base de datos

No depende del código TypeScript:

| Qué | Restricción |
|-----|-------------|
| Documentos | `UNIQUE (period, content_hash)` |
| Movimientos | PK `id` determinista (fuente + periodo + cuenta + fecha + importe + concepto + ordinal) |
| Conciliaciones | PK `(entry_id, document_hash)` |
| Incidencias | PK `id` determinista |
| Datáfono | PK `period` |

Además, reglas de negocio como CHECK: un movimiento interno no puede llevar P&L,
y un movimiento exento de documento tiene que decir por qué.

---

## Borrado

No hay políticas de DELETE, con dos excepciones acotadas: las asociaciones y las
incidencias **abiertas**, que el motor recalcula en cada pasada. Las decisiones
humanas viven en el movimiento (`review_status`) y en `incidents.status`, y el
recálculo las respeta.

---

## Qué falta

- Los tests de RLS contra un Supabase real ([tests/supabase-integration.test.ts](../tests/supabase-integration.test.ts)) se saltan hasta que existan credenciales.
- Rotación de claves y política de retención: cuando haya datos reales.
