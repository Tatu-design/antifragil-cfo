#!/usr/bin/env node
/**
 * Autoriza a un usuario a operar con los datos financieros.
 *
 *   npm run cfo:member -- correo@ejemplo.com owner
 *
 * Registrarse en Supabase Auth NO da acceso a nada: hace falta una fila en
 * `cfo_members`. Esa tabla no se puede escribir desde el cliente (por diseño),
 * así que esta es la única vía, y usa la Secret Key (`sb_secret_…`).
 *
 * Es EL ÚNICO sitio del proyecto donde se usa la Secret Key: es una tarea de
 * sistema que se ejecuta desde la máquina del administrador, nunca desde una
 * petición web. La operativa financiera va siempre con la sesión del usuario.
 */

import { createSecretClient } from "../lib/supabase/secret";

async function main(): Promise<number> {
  const [email, role = "owner"] = process.argv.slice(2);

  if (!email) {
    console.error("Uso: npm run cfo:member -- correo@ejemplo.com [owner|editor|viewer]");
    return 1;
  }
  if (!["owner", "editor", "viewer"].includes(role)) {
    console.error(`Rol no válido: "${role}". Usa owner, editor o viewer.`);
    return 1;
  }

  let supabase;
  try {
    supabase = createSecretClient();
  } catch {
    // El mensaje habla de la ausencia de la clave, nunca de su valor.
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno.\n" +
        "Ejecuta el comando con el archivo .env.local cargado.",
    );
    return 1;
  }

  // Se busca el usuario ya creado en Auth: este script autoriza, no registra.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error(`No se ha podido consultar Auth: ${error.message}`);
    return 1;
  }

  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(
      `No existe ningún usuario con el email ${email}.\n` +
        "Créalo primero en Supabase → Authentication → Users → Add user.",
    );
    return 1;
  }

  const { error: upsertError } = await supabase
    .from("cfo_members")
    .upsert({ user_id: user.id, email, role }, { onConflict: "user_id" });

  if (upsertError) {
    console.error(`No se ha podido autorizar: ${upsertError.message}`);
    return 1;
  }

  console.log(`\n✅ ${email} autorizado como ${role}.\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
