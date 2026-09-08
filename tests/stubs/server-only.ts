/**
 * Sustituto de `server-only` para los tests.
 *
 * El paquete real lanza al importarse fuera de un Server Component. En Vitest no
 * hay bundler de React, así que se sustituye por un módulo vacío: lo que se
 * prueba es la lógica del módulo, y que la marca `server-only` esté presente lo
 * verifica `security.test.ts` leyendo el código fuente.
 */
export {};
