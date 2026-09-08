import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renovación de sesión y primera barrera de acceso.
 *
 * IMPORTANTE: esto es una barrera, no LA barrera. Cada Route Handler y cada
 * página vuelve a comprobar la autorización en servidor (`lib/auth/guard.ts`),
 * porque el middleware puede quedar fuera de juego por configuración y porque
 * comprobar pertenencia a `cfo_members` requiere consultar la base de datos.
 *
 * Es **fail-closed**: si Supabase no está configurado, no se deja pasar a nadie
 * salvo que el modo local de desarrollo esté activado explícitamente y no
 * estemos en producción.
 */

const PUBLIC_PATHS = ["/login", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  if (!supabaseUrl || !supabaseKey) {
    const localDev =
      process.env.NODE_ENV !== "production" && process.env.ANTIFRAGIL_CFO_LOCAL_MODE === "1";

    // Sin Supabase y sin modo local explícito: no se sirve nada financiero.
    if (!localDev && !isPublic(pathname)) {
      return denied(request, pathname);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  // IMPORTANTE: getUser() justo después de crear el cliente, sin nada en medio.
  // Es lo que dispara la renovación del token cuando hace falta. Se usa getUser
  // y no getSession porque valida el token contra el servidor de Auth: el
  // contenido de la cookie por sí solo no es prueba de nada.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname)) {
    return denied(request, pathname);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

/**
 * Respuesta al acceso no autorizado.
 *
 * Una API devuelve 401 en JSON; una página redirige al login. Redirigir una
 * llamada de API daría un 200 con HTML, que el cliente interpretaría como éxito.
 */
function denied(request: NextRequest, pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Las rutas de API SÍ pasan por aquí: son las que sirven datos financieros.
  // Solo quedan fuera los recursos estáticos, que no llevan información.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|jpeg|webp)$).*)",
  ],
};
