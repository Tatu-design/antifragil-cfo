# Puesta en marcha de Supabase

Guía paso a paso. Sigue el orden; no hace falta decidir nada por el camino.

Este proyecto usa el **sistema moderno de API keys** de Supabase
(`sb_publishable_…` y `sb_secret_…`). Las claves antiguas `anon` y `service_role`
están siendo retiradas y **no se usan aquí**.

Al terminar tendrás: proyecto creado, esquema aplicado, bucket privado, tu
usuario creado y autorizado, y la aplicación funcionando con datos persistentes.

---

## Paso 1 · Crear la cuenta y el proyecto

1. Abre **https://supabase.com/dashboard** e inicia sesión (puedes entrar con GitHub).
2. Pulsa el botón verde **New project**.
3. **Organization**: si es tu primera vez, Supabase te pedirá crear una. Llámala `Antifragil`.
4. **Project name**: escribe exactamente

   ```
   antifragil-cfo
   ```

5. **Database Password**: pulsa **Generate a password** y luego el icono de copiar.
   Guárdala en tu gestor de contraseñas. No la necesitarás para la aplicación,
   pero sí para conectarte a la base de datos con otras herramientas, y **no se
   puede volver a ver**.
6. **Region**: elige

   ```
   West EU (Ireland) · eu-west-1
   ```

   Es la más cercana a España de las estándar, y deja los datos en la UE.
7. **Pricing plan**: Free está bien para empezar.
8. Pulsa **Create new project** y espera 1–2 minutos a que termine de aprovisionar.

---

## Paso 2 · Copiar las dos claves nuevas

1. En el menú lateral, abajo del todo: **Project Settings** (icono de engranaje).
2. Entra en **API Keys**.
3. Verás dos pestañas o secciones. La que necesitas es la de las claves nuevas:

   | En Supabase | Empieza por | Para qué |
   |---|---|---|
   | **Publishable key** | `sb_publishable_` | Clave pública. Va al navegador. Es normal que se vea |
   | **Secret key** | `sb_secret_` | Permisos totales. **Secreta** |

4. La **Publishable key** se ve directamente: cópiala.
5. La **Secret key** está oculta: pulsa **Reveal** (o **Create new secret key** si
   aún no hay ninguna) y cópiala.

> **Si ves una sección "Legacy API keys" con `anon` y `service_role`: ignórala.**
> Este proyecto no las usa. Si tu panel solo muestra esas, busca la pestaña
> **API Keys → New API keys**; en proyectos creados hoy vienen activadas por
> defecto.

> ⚠️ **La Secret key no se comparte con nadie, ni conmigo, ni por WhatsApp, ni en
> capturas.** Salta todas las protecciones de la base de datos. Si alguna vez se
> te escapa, vuelve a esa pantalla y pulsa **Rotate** para invalidarla.
>
> La Publishable key sí es pública por diseño: no da acceso a nada porque RLS la
> bloquea.

---

## Paso 3 · Crear el archivo `.env.local`

En la carpeta del proyecto, crea un archivo llamado `.env.local` (ya está
excluido de Git) con este contenido, sustituyendo los valores:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxx
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxx
```

- `NEXT_PUBLIC_SUPABASE_URL` → el **Project URL** (en Project Settings → Data API).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → la **Publishable key**.
- `SUPABASE_SECRET_KEY` → la **Secret key**. Solo se usa para darte de alta.

---

## Paso 4 · Aplicar las migraciones

Desde la terminal, sin copiar SQL a mano. Hace falta un **Personal Access Token**
porque las claves de API (Publishable y Secret) no dan acceso SQL, y es correcto
que no lo den.

1. Abre **https://supabase.com/dashboard/account/tokens** → **Generate new token**.
2. Nombre: `antifragil-cfo-migraciones`. Cópialo (empieza por `sbp_`).
3. Añádelo a `.env.local`:

   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_...
   ```

4. Ejecuta:

   ```bash
   npm run cfo:migrate
   ```

Aplica las migraciones en orden y verifica el resultado: tablas, RLS, políticas,
bucket privado, restricciones, índices, cuentas y funciones de autorización. Si
algo falla, se detiene y lo dice.

Cuando termines puedes **revocar el token** desde esa misma página: la aplicación
no lo necesita para funcionar.

---

## Paso 5 · Comprobar que el bucket es privado

1. Menú lateral → **Storage**.
2. Debe existir un bucket llamado **documentos**.
3. Comprueba que **NO** tiene la etiqueta `Public` junto al nombre. Si la
   tuviera, entra en el bucket → **Configuration** → desactiva *Public bucket*.

---

## Paso 6 · Crear tu usuario

Desde la terminal:

```bash
npm run cfo:user -- tu-email@ejemplo.com
```

Crea el usuario con una contraseña temporal que se muestra una sola vez.
Cámbiala tras el primer acceso desde Supabase → Authentication → Users.

Si prefieres hacerlo a mano: **Authentication → Users → Add user → Create new
user**, marcando **Auto Confirm User**.

---

## Paso 7 · Autorizar tu usuario

Crear el usuario **no** da acceso a los datos: hace falta estar en la lista de
miembros. Desde la terminal, en la carpeta del proyecto:

```bash
npm run cfo:member -- tu-email@ejemplo.com owner
```

Debe responder `✅ tu-email@ejemplo.com autorizado como owner.`

Este comando y `cfo:user` son los únicos que usan la Secret key.

---

## Paso 8 · Comprobar que funciona

Comprobación automática de todo el flujo, con datos sintéticos:

```bash
npm run build && npx next start -p 3000
npm run cfo:smoke -- http://localhost:3000 tu-email@ejemplo.com tu-contraseña
```

Recorre: sin sesión todo cerrado → login → subir → procesar → ver el mes → abrir
un documento → persistencia en PostgreSQL y Storage → cerrar sesión y volver a
comprobar el bloqueo.

Para limpiar lo que deje esa prueba:

```bash
npm run cfo:reset -- 2026-09
```

Y la comprobación a mano:

```bash
npm run dev
```

1. Abre **http://localhost:3000** → debe llevarte a `/login`.
2. Entra con tu email y contraseña → debe aparecer la portada.
3. Abre un mes cualquiera y sube un archivo de prueba.
4. Pulsa **Salir** → vuelve al login. Intenta abrir `http://localhost:3000/` y
   debe rechazarte otra vez.

Para comprobar la persistencia: para el servidor (Ctrl+C), arráncalo de nuevo y
vuelve a entrar. Los datos siguen ahí. También puedes abrirlo desde otro
navegador con las mismas credenciales.

---

## Si algo falla

**"Credenciales incorrectas"** → revisa email y contraseña en Authentication → Users.

**Entras pero dice que no tienes acceso** → falta el paso 7.

**"Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY"** → revisa `.env.local`
y reinicia `npm run dev` (las variables solo se leen al arrancar).

**"Invalid API key"** → comprueba que has copiado la clave entera y que la
Publishable empieza por `sb_publishable_` y la Secret por `sb_secret_`.

**Error al aplicar migraciones** → si dice que algo "ya existe", el esquema
estaba aplicado a medias: revísalo antes de repetir. Si falta el token, añade
`SUPABASE_ACCESS_TOKEN` a `.env.local`.

---

## Despliegue en Vercel (más adelante)

Las mismas tres variables van en **Project Settings → Environment Variables**.
`SUPABASE_SECRET_KEY` solo en el entorno de servidor y **nunca** con prefijo
`NEXT_PUBLIC_`.
