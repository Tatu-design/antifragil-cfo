import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Cabeceras de seguridad.
 *
 * Esta aplicación contiene información financiera, así que el nivel de
 * protección es igual o superior al del resto de aplicaciones Antifrágil.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline' es necesario para los estilos que inyecta Next.
      "style-src 'self' 'unsafe-inline'",
      isProduction ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Supabase (API y realtime) es el único destino externo previsto.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
