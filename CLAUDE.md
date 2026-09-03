# CLAUDE.md

> Este archivo dice dónde están las instrucciones completas.

Lee `.claude/CLAUDE.md` para la constitución completa del agente.

Orden de lectura al iniciar una sesión:

1. Este archivo (puntero)
2. `.claude/CLAUDE.md` — constitución del agente
3. `docs/SYSTEM_VISION.md` — ⭐ visión, contexto y decisiones cerradas (autoridad del proyecto)
4. `docs/FINANCIAL_RULES.md` — las reglas del dinero
5. `docs/ARCHITECTURE.md` — estado técnico actual
6. `docs/RUNBOOK.md` — operación mensual

**Recordatorio permanente:** este repositorio es público. Ningún dato financiero
real puede llegar a él. Todo lo real vive en `local-data/`, que no se versiona.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
<!-- END:nextjs-agent-rules -->
