/**
 * Tests de seguridad.
 *
 * Protegen las invariantes que, si se rompen, exponen información financiera:
 * que ninguna ruta sirva datos sin sesión, que el service_role no salga del
 * servidor y que el modo local no se active por accidente en producción.
 *
 * Estos tests leen el código fuente a propósito. Un test que dependa de que el
 * handler se acuerde de llamar al guard no detectaría el día en que alguien
 * añade una ruta nueva y se le olvida.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isLocalDevMode, isSupabaseConfigured } from "../lib/auth/guard";

const ROOT = path.resolve(__dirname, "..");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...(await walk(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe("todas las rutas de API exigen autorización", () => {
  it("cada Route Handler llama al guard antes de responder", async () => {
    const routes = (await walk(path.join(ROOT, "app", "api"))).filter((file) =>
      file.endsWith(`${path.sep}route.ts`),
    );

    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const source = await readFile(route, "utf8");
      const relative = path.relative(ROOT, route);

      expect(source, `${relative} no importa el guard`).toContain("@/lib/auth/api");
      expect(source, `${relative} no invoca guardApi`).toMatch(/await guardApi\(/);

      // El guard tiene que estar ANTES de tocar params, cuerpo o almacén.
      const guardIndex = source.indexOf("await guardApi(");
      const paramsIndex = source.indexOf("await params");
      if (paramsIndex >= 0) {
        expect(guardIndex, `${relative} lee params antes de autorizar`).toBeLessThan(paramsIndex);
      }
      const bodyIndex = source.indexOf("request.formData()");
      if (bodyIndex >= 0) {
        expect(guardIndex, `${relative} lee el cuerpo antes de autorizar`).toBeLessThan(bodyIndex);
      }
    }
  });

  it("las páginas financieras comprueban la sesión en servidor", async () => {
    const pages = [
      path.join(ROOT, "app", "page.tsx"),
      path.join(ROOT, "app", "periodo", "[period]", "page.tsx"),
    ];

    for (const page of pages) {
      const source = await readFile(page, "utf8");
      const relative = path.relative(ROOT, page);
      expect(source, `${relative} no autoriza`).toContain("authorize()");
      expect(source, `${relative} no redirige al login`).toContain('redirect("/login")');
    }
  });

  it("el middleware cubre también las rutas de API", async () => {
    const source = await readFile(path.join(ROOT, "proxy.ts"), "utf8");

    // El matcher no debe excluir /api: son las rutas que sirven datos.
    const matcher = /matcher:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
    expect(matcher).not.toContain("api|");
    // Y una API no autorizada responde 401, no un redirect con HTML.
    expect(source).toContain('pathname.startsWith("/api/")');
    expect(source).toContain("status: 401");
  });
});

describe("el service_role no sale del servidor", () => {
  it("nunca se prefija con NEXT_PUBLIC_", async () => {
    const files = [
      ...(await walk(path.join(ROOT, "lib"))),
      ...(await walk(path.join(ROOT, "app"))),
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${path.relative(ROOT, file)} expone la service_role`).not.toContain(
        "NEXT_PUBLIC_SUPABASE_SERVICE",
      );
      expect(source).not.toContain("NEXT_PUBLIC_SERVICE_ROLE");
    }
  });

  it("solo se usa en módulos marcados como server-only", async () => {
    const files = [
      ...(await walk(path.join(ROOT, "lib"))),
      ...(await walk(path.join(ROOT, "app"))),
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!source.includes("SUPABASE_SERVICE_ROLE_KEY")) continue;

      const relative = path.relative(ROOT, file);
      expect(source, `${relative} usa service_role sin server-only`).toContain('import "server-only"');
      expect(source, `${relative} usa service_role en un Client Component`).not.toContain(
        '"use client"',
      );
    }
  });

  it("ningún Client Component importa el cliente privilegiado", async () => {
    const files = [
      ...(await walk(path.join(ROOT, "lib"))),
      ...(await walk(path.join(ROOT, "app"))),
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!source.trimStart().startsWith('"use client"')) continue;

      const relative = path.relative(ROOT, file);
      expect(source, `${relative} importa el cliente admin`).not.toContain("supabase/admin");
      expect(source, `${relative} importa el repositorio de servidor`).not.toContain(
        "@/lib/repositories",
      );
    }
  });

  it("el cliente privilegiado no se usa en la operativa normal", async () => {
    const files = await walk(path.join(ROOT, "lib"));
    const users = files.filter((file) => !file.endsWith(path.join("supabase", "admin.ts")));

    const withAdmin: string[] = [];
    for (const file of users) {
      const source = await readFile(file, "utf8");
      if (source.includes("createAdminClient")) withAdmin.push(path.relative(ROOT, file));
    }

    // La subida, la lectura y la persistencia van con el cliente de sesión, de
    // forma que RLS es quien autoriza. El admin queda para tareas de sistema.
    expect(withAdmin).toEqual([]);
  });
});

describe("modo local de desarrollo", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.ANTIFRAGIL_CFO_LOCAL_MODE;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("está desactivado si no se pide explícitamente", () => {
    expect(isLocalDevMode()).toBe(false);
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("se activa solo con la variable explícita y fuera de producción", () => {
    process.env.ANTIFRAGIL_CFO_LOCAL_MODE = "1";
    expect(isLocalDevMode()).toBe(true);
  });

  it("nunca se activa si Supabase está configurado", () => {
    process.env.ANTIFRAGIL_CFO_LOCAL_MODE = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ejemplo.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "clave-publica-de-ejemplo";

    expect(isSupabaseConfigured()).toBe(true);
    expect(isLocalDevMode()).toBe(false);
  });
});

describe("secretos fuera del repositorio", () => {
  it(".gitignore excluye los archivos de entorno y los datos reales", async () => {
    const gitignore = await readFile(path.join(ROOT, ".gitignore"), "utf8");

    expect(gitignore).toContain(".env");
    expect(gitignore).toContain("/local-data/**");
    expect(gitignore).toContain("*.pem");
    expect(gitignore).toContain("*.key");
  });

  it(".env.example documenta nombres, nunca valores", async () => {
    const example = await readFile(path.join(ROOT, ".env.example"), "utf8");

    expect(example).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(example).toContain("SUPABASE_SERVICE_ROLE_KEY");
    // Un JWT real empieza por "eyJ": si aparece, se ha colado una clave.
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });
});

describe("el bucket de documentos es privado", () => {
  it("la migración lo crea como privado y sin políticas de borrado", async () => {
    const migration = await readFile(
      path.join(ROOT, "supabase", "migrations", "0002_documents_storage.sql"),
      "utf8",
    );

    expect(migration).toMatch(/'documentos',\s*\n?\s*false/);
    expect(migration).toContain("public.is_cfo_member()");
    expect(migration).toContain("public.can_edit_cfo()");
    expect(migration).not.toMatch(/for delete/i);
    expect(migration).not.toMatch(/getPublicUrl|public = true/i);
  });

  it("la aplicación no genera URLs públicas", async () => {
    const files = [
      ...(await walk(path.join(ROOT, "lib"))),
      ...(await walk(path.join(ROOT, "app"))),
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${path.relative(ROOT, file)} usa getPublicUrl`).not.toContain("getPublicUrl");
    }
  });

  it("las URLs firmadas son de vida corta", async () => {
    const source = await readFile(path.join(ROOT, "lib", "ingest", "storage.ts"), "utf8");
    const match = /expiresInSeconds\s*=\s*(\d+)/.exec(source);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(600);
  });
});

describe("RLS declarada en el esquema", () => {
  it("todas las tablas financieras tienen RLS activada", async () => {
    const migration = await readFile(
      path.join(ROOT, "supabase", "migrations", "0001_financial_ledger.sql"),
      "utf8",
    );

    const created = [...migration.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
    const enabled = [...migration.matchAll(/alter table public\.([a-z_]+)\s+enable row level security/g)].map(
      (m) => m[1],
    );

    expect(created.length).toBeGreaterThan(0);
    for (const table of created) {
      expect(enabled, `la tabla ${table} no tiene RLS`).toContain(table);
    }
  });

  it("el acceso se concede por pertenencia, no por estar autenticado", async () => {
    const migration = await readFile(
      path.join(ROOT, "supabase", "migrations", "0001_financial_ledger.sql"),
      "utf8",
    );

    // Ninguna política puede abrirse a cualquier usuario autenticado.
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/to\s+authenticated\b/i);
    expect(migration).toContain("public.is_cfo_member()");
  });

  it("no hay políticas de borrado salvo el recálculo del motor", async () => {
    const migration = await readFile(
      path.join(ROOT, "supabase", "migrations", "0001_financial_ledger.sql"),
      "utf8",
    );

    const deletePolicies = [...migration.matchAll(/create policy (\w+)[\s\S]{0,120}?for delete/g)].map(
      (m) => m[1],
    );

    // Solo las asociaciones y las incidencias abiertas, que son cálculo del
    // motor y no información introducida por una persona.
    expect(deletePolicies.sort()).toEqual(["entry_documents_delete", "incidents_delete_open"]);
  });
});
