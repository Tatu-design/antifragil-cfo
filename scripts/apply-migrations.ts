#!/usr/bin/env node
/**
 * Aplica y verifica las migraciones contra el proyecto Supabase real.
 *
 *   npm run cfo:migrate
 *
 * Necesita un **Personal Access Token** de Supabase (`sbp_…`) en la variable
 * SUPABASE_ACCESS_TOKEN. Ni la Publishable Key ni la Secret Key sirven para
 * esto: son claves de API (PostgREST, Auth, Storage) y no dan acceso SQL. Es
 * correcto que no lo den — si lo dieran, cualquiera con la clave del servidor
 * podría reescribir el esquema.
 *
 * El token se usa solo aquí, desde la máquina del administrador, y nunca se
 * imprime. Las migraciones se aplican en orden y de forma verificable: si algo
 * falla, se detiene y lo dice sin dejar el esquema a medias en silencio.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MANAGEMENT_API = "https://api.supabase.com/v1";
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "supabase", "migrations");

interface QueryResult {
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  error?: string;
}

async function runSql(ref: string, token: string, query: string): Promise<QueryResult> {
  const response = await fetch(`${MANAGEMENT_API}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  if (!response.ok) {
    // El cuerpo puede traer el detalle del error de PostgreSQL, que sí interesa.
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      message = parsed.message ?? text;
    } catch {
      // Se queda el texto tal cual.
    }
    return { ok: false, rows: [], error: message };
  }

  try {
    return { ok: true, rows: JSON.parse(text) as Array<Record<string, unknown>> };
  } catch {
    return { ok: true, rows: [] };
  }
}

function projectRef(url: string): string | null {
  const match = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url);
  return match ? match[1] : null;
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!url) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL. Ejecuta con .env.local cargado.");
    return 1;
  }
  const ref = projectRef(url);
  if (!ref) {
    console.error(`No se ha podido deducir el project ref de la URL: ${url}`);
    return 1;
  }
  if (!token) {
    console.error(
      "\nFalta SUPABASE_ACCESS_TOKEN (Personal Access Token, empieza por sbp_).\n" +
        "Se obtiene en https://supabase.com/dashboard/account/tokens → Generate new token.\n" +
        "Añádelo a .env.local como SUPABASE_ACCESS_TOKEN=sbp_...\n",
    );
    return 1;
  }

  console.log(`\n🗄️  Proyecto: ${ref}\n`);

  // ── 1 · Aplicar migraciones en orden ──────────────────────────────────────
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`   ${file} … `);

    const result = await runSql(ref, token, sql);
    if (!result.ok) {
      console.log("❌");
      console.error(`\n   ${result.error}\n`);
      console.error(
        "   La migración no se ha aplicado. Corrige el error y vuelve a ejecutar.\n" +
          "   Si el error dice que algo ya existe, el esquema estaba aplicado a medias:\n" +
          "   revísalo antes de continuar.\n",
      );
      return 1;
    }
    console.log("✅");
  }

  // ── 2 · Verificar el resultado ────────────────────────────────────────────
  console.log("\n🔍 Verificación\n");
  const checks = await verify(ref, token);
  for (const line of checks.lines) console.log(`   ${line}`);

  console.log("");
  return checks.ok ? 0 : 2;
}

async function verify(ref: string, token: string): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;

  // Tablas y RLS
  const tables = await runSql(
    ref,
    token,
    `select tablename, rowsecurity from pg_tables
     where schemaname = 'public' order by tablename;`,
  );
  if (!tables.ok) return { ok: false, lines: [`❌ no se ha podido verificar: ${tables.error}`] };

  const withoutRls = tables.rows.filter((r) => r.rowsecurity !== true).map((r) => r.tablename);
  lines.push(`Tablas en public: ${tables.rows.length}`);
  if (withoutRls.length > 0) {
    ok = false;
    lines.push(`❌ SIN RLS: ${withoutRls.join(", ")}`);
  } else {
    lines.push(`✅ RLS activa en las ${tables.rows.length} tablas`);
  }

  // Políticas
  const policies = await runSql(
    ref,
    token,
    `select schemaname, tablename, count(*)::int as n from pg_policies
     where schemaname in ('public','storage') group by 1,2 order by 1,2;`,
  );
  const total = policies.rows.reduce((acc, r) => acc + Number(r.n ?? 0), 0);
  const storagePolicies = policies.rows.filter((r) => r.schemaname === "storage");
  lines.push(`✅ Políticas RLS: ${total} (public) + ${storagePolicies.length} tablas en storage`);
  if (total === 0) {
    ok = false;
    lines.push("❌ no hay políticas: las tablas quedarían inaccesibles");
  }

  // Bucket privado
  const buckets = await runSql(
    ref,
    token,
    `select id, public from storage.buckets where id = 'documentos';`,
  );
  if (buckets.rows.length === 0) {
    ok = false;
    lines.push("❌ el bucket 'documentos' no existe");
  } else if (buckets.rows[0].public === true) {
    ok = false;
    lines.push("❌ el bucket 'documentos' es PÚBLICO");
  } else {
    lines.push("✅ bucket 'documentos' existe y es privado");
  }

  // Restricciones clave de idempotencia y de negocio
  const constraints = await runSql(
    ref,
    token,
    `select conname from pg_constraint
     where conname in (
       'documents_unique_per_period',
       'ledger_internal_has_no_pnl',
       'ledger_not_required_has_reason',
       'documents_statement_needs_account',
       'entry_documents_document_fk'
     ) order by conname;`,
  );
  const found = constraints.rows.map((r) => String(r.conname));
  const expected = [
    "documents_statement_needs_account",
    "documents_unique_per_period",
    "entry_documents_document_fk",
    "ledger_internal_has_no_pnl",
    "ledger_not_required_has_reason",
  ];
  const missing = expected.filter((c) => !found.includes(c));
  if (missing.length > 0) {
    ok = false;
    lines.push(`❌ faltan restricciones: ${missing.join(", ")}`);
  } else {
    lines.push(`✅ restricciones de idempotencia y negocio: ${found.length}/${expected.length}`);
  }

  // Índices
  const indexes = await runSql(
    ref,
    token,
    `select count(*)::int as n from pg_indexes where schemaname = 'public';`,
  );
  lines.push(`✅ índices en public: ${indexes.rows[0]?.n ?? 0}`);

  // Cuentas sembradas
  const accounts = await runSql(
    ref,
    token,
    `select id from public.treasury_accounts order by id;`,
  );
  const accountIds = accounts.rows.map((r) => String(r.id));
  if (accountIds.length !== 3) {
    ok = false;
    lines.push(`❌ cuentas de tesorería: ${accountIds.length}/3 (${accountIds.join(", ")})`);
  } else {
    lines.push(`✅ cuentas de tesorería: ${accountIds.join(", ")}`);
  }

  // Funciones de autorización
  const functions = await runSql(
    ref,
    token,
    `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and proname in ('is_cfo_member','can_edit_cfo') order by proname;`,
  );
  if (functions.rows.length !== 2) {
    ok = false;
    lines.push("❌ faltan las funciones de autorización");
  } else {
    lines.push("✅ funciones is_cfo_member() y can_edit_cfo()");
  }

  lines.push(ok ? "\n   🟢 Esquema aplicado y verificado." : "\n   ⛔ Hay problemas que revisar.");
  return { ok, lines };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Nunca se imprime el token ni ninguna credencial.
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
