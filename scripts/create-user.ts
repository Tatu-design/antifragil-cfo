#!/usr/bin/env node
/**
 * Crea un usuario de Supabase Auth con una contraseña temporal.
 *
 *   npm run cfo:user -- correo@ejemplo.com
 *
 * Es una tarea administrativa: usa la Secret Key, que es lo único capaz de
 * crear usuarios. La contraseña se genera aquí, se muestra UNA vez y hay que
 * cambiarla desde Supabase en cuanto se entre.
 *
 * Si el usuario ya existe, no hace nada y lo dice: este script no reescribe
 * credenciales de nadie.
 */

import { randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase-admin";

/** Contraseña temporal legible pero con suficiente entropía (~72 bits). */
function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

async function main(): Promise<number> {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: npm run cfo:user -- correo@ejemplo.com");
    return 1;
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno.");
    return 1;
  }

  const { data: existing, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    console.error(`No se ha podido consultar Auth: ${listError.message}`);
    return 1;
  }

  const already = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (already) {
    console.log(`\nℹ️  ${email} ya existe. No se toca su contraseña.\n`);
    return 0;
  }

  const password = temporaryPassword();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    // Sin confirmación por correo: el alta la hace el administrador.
    email_confirm: true,
  });

  if (error) {
    console.error(`No se ha podido crear el usuario: ${error.message}`);
    return 1;
  }

  console.log(`\n✅ Usuario creado: ${email}`);
  console.log(`   Contraseña temporal: ${password}`);
  console.log(`   Cámbiala tras el primer acceso.\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
