/**
 * Tests de autorización.
 *
 * Comprueban el comportamiento real del guard con distintas sesiones: sin
 * autenticar, autenticado pero sin autorizar, y miembro con y sin permiso de
 * escritura. Es lo que decide si un extraño puede leer las finanzas.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Cliente de Supabase falso: controla qué usuario y qué pertenencia devuelve. */
interface FakeSession {
  user: { id: string; email: string } | null;
  member: { user_id: string; email: string; role: string } | null;
}

const session: FakeSession = { user: null, member: null };

vi.mock("../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      // getUser valida contra el servidor de Auth; es el que debe usarse.
      getUser: async () => ({ data: { user: session.user }, error: null }),
      getSession: async () => {
        throw new Error("getSession no debe usarse para autorizar");
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: session.member, error: null }),
        }),
      }),
    }),
  }),
}));

const { authorize, canWrite } = await import("../lib/auth/guard");
const { guardApi } = await import("../lib/auth/api");

beforeEach(() => {
  session.user = null;
  session.member = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ejemplo.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ejemplo";
  delete process.env.ANTIFRAGIL_CFO_LOCAL_MODE;
});

describe("usuario no autenticado", () => {
  it("no obtiene autorización", async () => {
    const result = await authorize();
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("recibe 401 en cualquier operación de la API", async () => {
    const guard = await guardApi();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
    await expect(guard.response.json()).resolves.toEqual({ error: "No autorizado." });
  });

  it("recibe 401 también al intentar escribir", async () => {
    const guard = await guardApi({ write: true });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
  });
});

describe("usuario autenticado pero no autorizado", () => {
  beforeEach(() => {
    session.user = { id: "usuario-cualquiera", email: "alguien@example.com" };
    session.member = null; // no está en cfo_members
  });

  it("no obtiene acceso a los datos financieros", async () => {
    const result = await authorize();
    expect(result).toEqual({ ok: false, reason: "not_member" });
  });

  it("recibe 403, no 401: existe, pero no tiene permiso", async () => {
    const guard = await guardApi();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(403);
  });

  it("el mensaje no revela por qué ha fallado", async () => {
    const guard = await guardApi();
    if (guard.ok) return;
    const payload = await guard.response.json();
    expect(payload.error).toBe("No autorizado.");
    expect(JSON.stringify(payload)).not.toContain("cfo_members");
  });
});

describe("miembro autorizado", () => {
  beforeEach(() => {
    session.user = { id: "propietario", email: "propietario@example.com" };
    session.member = { user_id: "propietario", email: "propietario@example.com", role: "owner" };
  });

  it("obtiene autorización con su rol", async () => {
    const result = await authorize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe("propietario");
    expect(result.user.role).toBe("owner");
    expect(result.user.isLocalDev).toBe(false);
  });

  it("puede leer y escribir", async () => {
    await expect(guardApi().then((g) => g.ok)).resolves.toBe(true);
    await expect(guardApi({ write: true }).then((g) => g.ok)).resolves.toBe(true);
  });
});

describe("miembro de solo lectura", () => {
  beforeEach(() => {
    session.user = { id: "revisor", email: "revisor@example.com" };
    session.member = { user_id: "revisor", email: "revisor@example.com", role: "viewer" };
  });

  it("puede leer", async () => {
    const guard = await guardApi();
    expect(guard.ok).toBe(true);
  });

  it("no puede escribir", async () => {
    const guard = await guardApi({ write: true });
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(403);
  });

  it("canWrite refleja el rol", async () => {
    const result = await authorize();
    if (!result.ok) throw new Error("debería estar autorizado");
    expect(canWrite(result.user)).toBe(false);
  });
});

describe("sin Supabase configurado", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  it("no deja pasar a nadie por defecto (fail-closed)", async () => {
    const result = await authorize();
    expect(result).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("solo el modo local explícito abre la puerta, y fuera de producción", async () => {
    process.env.ANTIFRAGIL_CFO_LOCAL_MODE = "1";
    const result = await authorize();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.isLocalDev).toBe(true);
  });
});
