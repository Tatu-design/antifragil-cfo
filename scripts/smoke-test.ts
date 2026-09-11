#!/usr/bin/env node
/**
 * Smoke test end-to-end contra el servidor real y Supabase real.
 *
 *   npm run cfo:smoke -- http://localhost:3200 correo@ejemplo.com contraseña
 *
 * Ejercita el flujo completo con datos SINTÉTICOS, como lo haría una persona:
 *
 *   sin sesión → todo cerrado
 *   login → subir documentos → procesar → ver el mes → abrir un documento
 *   sin sesión otra vez → todo cerrado
 *
 * No usa la Secret Key: entra como el usuario, con su sesión, igual que el
 * navegador. Si algo pasa sin estar autorizado, este script lo detecta.
 */

import { createClient } from "@supabase/supabase-js";

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

const steps: Step[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  steps.push({ name, ok, detail });
  console.log(`   ${ok ? "✅" : "❌"} ${name}${detail ? ` · ${detail}` : ""}`);
}

/**
 * Cookie de sesión en el formato de @supabase/ssr.
 *
 * El paquete guarda la sesión como `base64-` + base64 del JSON, troceada si no
 * cabe. Replicarlo aquí permite hablar con la aplicación exactamente como lo
 * haría el navegador, sin depender de un navegador real.
 */
function sessionCookies(projectRef: string, session: unknown): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64")}`;
  const MAX = 3180;

  if (value.length <= MAX) return `${name}=${value}`;

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  return chunks.map((chunk, index) => `${name}.${index}=${chunk}`).join("; ");
}

function syntheticFiles(): Array<{ name: string; type: string; body: string }> {
  return [
    {
      name: "Extracto SL septiembre 2026.csv",
      type: "text/csv",
      body: [
        "Fecha;Concepto;Importe",
        "03/09/2026;PAGO TARJETA PROVEEDOR DIGITAL SL;-21,83",
        "05/09/2026;LIQUIDACION DE REMESAS DE COMERCIO;1.200,00",
        "12/09/2026;TRANSFERENCIA RECIBIDA CLIENTE DEMO;500,00",
        "30/09/2026;COMISION MANTENIMIENTO;-12,00",
      ].join("\n"),
    },
    {
      name: "Extracto SC septiembre 2026.csv",
      type: "text/csv",
      body: ["Fecha;Concepto;Importe", "20/09/2026;AEAT MODELO 303 DEMO;-350,00"].join("\n"),
    },
    {
      name: "I_Ventas Clinica Banco Septiembre 26.csv",
      type: "text/csv",
      body: [
        "Fecha;Concepto;Importe",
        "04/09/2026;Sesion demo;600,00",
        "19/09/2026;Bono demo;600,00",
      ].join("\n"),
    },
    {
      name: "G_Proveedor Digital Septiembre 26 (2183).pdf",
      type: "application/pdf",
      body: "documento sintetico: factura de proveedor digital",
    },
    {
      name: "G_Modelo 303 Septiembre 26 (35000).pdf",
      type: "application/pdf",
      body: "documento sintetico: modelo 303",
    },
  ];
}

async function main(): Promise<number> {
  const [baseUrl, email, password] = process.argv.slice(2);
  const period = process.env.SMOKE_PERIOD ?? "2026-09";

  if (!baseUrl || !email || !password) {
    console.error("Uso: npm run cfo:smoke -- http://localhost:3200 correo@ejemplo.com contraseña");
    return 1;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const projectRef = supabaseUrl.replace("https://", "").split(".")[0];

  console.log(`\n🧪 Smoke test · ${baseUrl} · periodo ${period}\n`);

  // ── 1 · Sin sesión, todo cerrado ──────────────────────────────────────────
  console.log("1 · Sin sesión");
  for (const [method, route, expected] of [
    ["GET", "/", 307],
    ["GET", `/periodo/${period}`, 307],
    ["POST", `/api/periodos/${period}/procesar`, 401],
    ["GET", `/api/documentos/${period}/x.pdf`, 401],
  ] as Array<[string, string, number]>) {
    const response = await fetch(`${baseUrl}${route}`, { method, redirect: "manual" });
    record(`${method} ${route}`, response.status === expected, `HTTP ${response.status}`);
  }

  // ── 2 · Login real ────────────────────────────────────────────────────────
  console.log("\n2 · Autenticación");
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (authError || !auth.session) {
    record("login", false, authError?.message ?? "sin sesión");
    return report();
  }
  record("login", true, `usuario ${auth.user?.email}`);

  const cookie = sessionCookies(projectRef, auth.session);
  const authed = (extra: RequestInit = {}): RequestInit => ({
    ...extra,
    headers: { ...(extra.headers ?? {}), cookie },
    redirect: "manual",
  });

  const home = await fetch(`${baseUrl}/`, authed());
  record("la portada deja entrar con sesión", home.status === 200, `HTTP ${home.status}`);
  if (home.status !== 200) return report();

  // ── 3 · Subir documentos ──────────────────────────────────────────────────
  console.log("\n3 · Carga de documentos sintéticos");
  const form = new FormData();
  for (const file of syntheticFiles()) {
    form.append("files", new Blob([file.body], { type: file.type }), file.name);
  }

  const upload = await fetch(
    `${baseUrl}/api/periodos/${period}/documentos`,
    authed({ method: "POST", body: form }),
  );
  const uploadBody = (await upload.json()) as {
    headline?: string[];
    recognized?: number;
    documents?: Array<{ kind: string | null; accountId: string | null }>;
  };
  record("subida", upload.status === 200, uploadBody.headline?.join(" · ") ?? `HTTP ${upload.status}`);

  // Si los documentos ya estaban (segunda ejecución), la respuesta no trae
  // reconocimiento porque son duplicados: entonces se comprueba lo que hay
  // persistido, que es lo que de verdad importa.
  let accounts = (uploadBody.documents ?? [])
    .filter((d) => d.kind === "bank_statement")
    .map((d) => d.accountId);

  if (accounts.length === 0) {
    const { data: stored } = await supabase
      .from("documents")
      .select("account_id")
      .eq("period", period)
      .eq("kind", "bank_statement");
    accounts = (stored ?? []).map((row) => row.account_id as string | null);
  }

  record(
    "cuentas SL y SC detectadas",
    accounts.includes("sl_bank") && accounts.includes("sc_bank"),
    accounts.filter(Boolean).join(", "),
  );

  // Idempotencia: la misma carga otra vez no duplica nada.
  const form2 = new FormData();
  for (const file of syntheticFiles()) {
    form2.append("files", new Blob([file.body], { type: file.type }), file.name);
  }
  const again = await fetch(
    `${baseUrl}/api/periodos/${period}/documentos`,
    authed({ method: "POST", body: form2 }),
  );
  const againBody = (await again.json()) as { duplicates?: number; recognized?: number };
  record(
    "resubir los mismos archivos no duplica",
    againBody.duplicates === 5 && againBody.recognized === 0,
    `${againBody.duplicates} duplicados ignorados`,
  );

  // ── 4 · Procesar ──────────────────────────────────────────────────────────
  console.log("\n4 · Procesado");
  const process1 = await fetch(
    `${baseUrl}/api/periodos/${period}/procesar`,
    authed({ method: "POST" }),
  );
  const result = (await process1.json()) as {
    mode?: string;
    movements?: number;
    reconciledPct?: number;
    skipped?: Array<{ file: string; reason: string }>;
  };
  record(
    "procesar el mes",
    process1.status === 200 && (result.movements ?? 0) > 0,
    `${result.mode} · ${result.movements} movimientos · ${result.reconciledPct}% conciliado`,
  );
  if ((result.skipped ?? []).length > 0) {
    record("sin fuentes descartadas", false, JSON.stringify(result.skipped));
  }

  // Reprocesar no duplica movimientos.
  const process2 = await fetch(
    `${baseUrl}/api/periodos/${period}/procesar`,
    authed({ method: "POST" }),
  );
  const result2 = (await process2.json()) as { movements?: number };
  record(
    "reprocesar no duplica movimientos",
    result2.movements === result.movements,
    `${result2.movements} movimientos`,
  );

  // ── 5 · Ver el mes y abrir un documento ───────────────────────────────────
  console.log("\n5 · Revisión");
  const page = await fetch(`${baseUrl}/periodo/${period}`, authed());
  const html = await page.text();
  record("la vista del mes carga", page.status === 200, `HTTP ${page.status}`);
  record(
    "muestra las tres tesorerías",
    html.includes("Banco SL") && html.includes("Banco SC") && html.includes("Caja"),
  );
  record("muestra movimientos conciliados", html.includes("Conciliado"));

  const documentPath = /\/api\/documentos\/[^"']+/.exec(html)?.[0];
  if (!documentPath) {
    record("hay un documento enlazado", false);
  } else {
    const doc = await fetch(`${baseUrl}${documentPath}`, authed());
    record(
      "abrir el documento desde el asiento",
      doc.status === 200 || doc.status === 307,
      `HTTP ${doc.status}`,
    );

    // Y sin sesión, ese mismo documento no se abre.
    const denied = await fetch(`${baseUrl}${documentPath}`, { redirect: "manual" });
    record("ese documento NO se abre sin sesión", denied.status === 401, `HTTP ${denied.status}`);
  }

  // ── 6 · Persistencia en Supabase ──────────────────────────────────────────
  console.log("\n6 · Persistencia");
  const { data: entries } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("period", period);
  const { data: docs } = await supabase.from("documents").select("content_hash").eq("period", period);
  record("movimientos guardados en PostgreSQL", (entries?.length ?? 0) > 0, `${entries?.length} filas`);
  record("documentos guardados en PostgreSQL", (docs?.length ?? 0) === 5, `${docs?.length} filas`);

  const { data: files } = await supabase.storage.from("documentos").list(period);
  record("archivos en el bucket privado", (files?.length ?? 0) === 5, `${files?.length} objetos`);

  // ── 7 · Cerrar sesión ─────────────────────────────────────────────────────
  console.log("\n7 · Tras cerrar sesión");
  await supabase.auth.signOut();
  const afterLogout = await fetch(`${baseUrl}/periodo/${period}`, { redirect: "manual" });
  record("la vista del mes vuelve a estar cerrada", afterLogout.status === 307, `HTTP ${afterLogout.status}`);

  return report();
}

function report(): number {
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${steps.length - failed.length}/${steps.length} comprobaciones correctas`);
  if (failed.length > 0) {
    console.log("\nFallos:");
    for (const step of failed) console.log(`  ❌ ${step.name} · ${step.detail}`);
  }
  console.log("");
  return failed.length === 0 ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
