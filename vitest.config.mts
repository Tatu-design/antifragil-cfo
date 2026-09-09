import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

/**
 * Los tests de integración necesitan las credenciales reales del proyecto.
 * Vitest no lee `.env.local` por sí solo, así que se cargan aquí. Sin ellas, esa
 * suite se salta y el resto funciona igual.
 */
const env = loadEnv("development", import.meta.dirname, "");
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
]) {
  if (env[key] && !process.env[key]) process.env[key] = env[key];
}

export default defineConfig({
  resolve: {
    alias: {
      // Ver tests/stubs/server-only.ts
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
