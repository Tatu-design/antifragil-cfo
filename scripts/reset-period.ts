#!/usr/bin/env node
/**
 * Borra por completo un periodo: movimientos, documentos, archivos y traza.
 *
 *   npm run cfo:reset -- 2026-09
 *
 * Existe para limpiar pruebas sintéticas, NO para operar con datos reales: la
 * aplicación no tiene forma de borrar nada (no hay políticas de DELETE), y eso
 * es deliberado. Este script usa la Secret Key y se ejecuta a mano.
 *
 * Pide confirmación escribiendo el periodo, para que no se borre un mes real
 * por un error de tecleo.
 */

import { createInterface } from "node:readline/promises";
import { createAdminClient } from "./supabase-admin";

async function main(): Promise<number> {
  const period = process.argv[2];
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    console.error("Uso: npm run cfo:reset -- YYYY-MM");
    return 1;
  }

  const supabase = createAdminClient();

  const { count: entries } = await supabase
    .from("ledger_entries")
    .select("*", { count: "exact", head: true })
    .eq("period", period);
  const { count: documents } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true })
    .eq("period", period);

  console.log(`\n⚠️  Se van a borrar ${entries ?? 0} movimientos y ${documents ?? 0} documentos de ${period}.`);

  if (!process.env.CFO_RESET_YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`   Escribe "${period}" para confirmar: `);
    rl.close();
    if (answer.trim() !== period) {
      console.log("\nCancelado.\n");
      return 1;
    }
  }

  // Los archivos primero: si algo falla, la metadata sigue apuntando a ellos.
  const { data: files } = await supabase.storage.from("documentos").list(period);
  if (files && files.length > 0) {
    await supabase.storage.from("documentos").remove(files.map((f) => `${period}/${f.name}`));
  }

  // El orden respeta las claves foráneas.
  await supabase.from("entry_documents").delete().eq("period", period);
  await supabase.from("incidents").delete().eq("period", period);
  await supabase.from("card_settlements").delete().eq("period", period);
  await supabase.from("close_comparisons").delete().eq("period", period);
  await supabase.from("ledger_entries").delete().eq("period", period);
  await supabase.from("documents").delete().eq("period", period);
  await supabase.from("document_uploads").delete().eq("period", period);
  await supabase.from("periods").delete().eq("period", period);

  console.log(`\n✅ Periodo ${period} vaciado (${files?.length ?? 0} archivos eliminados).\n`);
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
