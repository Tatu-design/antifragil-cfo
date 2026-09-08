import "server-only";
import { NextResponse } from "next/server";
import { authorize, canWrite, type AuthorizedUser } from "./guard";

/**
 * Guarda de autorización para Route Handlers.
 *
 * Se llama SIEMPRE como primera línea del handler, antes de leer el cuerpo de
 * la petición, tocar el almacén o consultar nada. Un handler que no empiece por
 * aquí es un agujero de seguridad.
 *
 * Los mensajes de error son deliberadamente escuetos: no revelan si el usuario
 * existe, si el periodo existe ni por qué falló exactamente.
 */

export type GuardResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; response: NextResponse };

export async function guardApi(options: { write?: boolean } = {}): Promise<GuardResult> {
  const result = await authorize();

  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No autorizado." },
        { status: result.reason === "unauthenticated" ? 401 : 403 },
      ),
    };
  }

  if (options.write && !canWrite(result.user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Permisos insuficientes." }, { status: 403 }),
    };
  }

  return { ok: true, user: result.user };
}

/**
 * Convierte un error interno en una respuesta segura.
 *
 * Nunca se devuelve al cliente el mensaje original: puede contener rutas,
 * nombres de bucket, consultas SQL o fragmentos de credenciales.
 */
export function safeError(error: unknown, fallback: string): NextResponse {
  // El detalle queda en el servidor, donde sí es útil para depurar.
  console.error("[antifragil-cfo]", error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: fallback }, { status: 500 });
}
