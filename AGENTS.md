<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project verification commands

- Frontend unit tests: `npm test`
- TypeScript check: `npm run typecheck`
- Production build: `npm run build`
- Backend tests: `pytest api/tests -q`
- Backend dev server: `uvicorn api.app.main:app --reload`

The frontend is a Next.js app and the backend is a FastAPI package under `api/`. Canonical trace fixtures live in `fixtures/` and should remain valid according to `lib/validate.ts` and `api/app/schemas.py`.

## Local environment note

The user's C: drive can become completely full. If Vitest or other tools fail with `ENOSPC` even though D: has space, run commands with `TEMP=D:\temp` and `TMP=D:\temp` and use `npm_config_cache=D:\npm-cache` for npm cache writes.
