# AGENTS

This file orients coding agents working in this repo.
Keep guidance aligned with current code and tooling.

## Repository overview
- Runtime: Node.js + Next.js (App Router) + TypeScript (ESM).
- Source lives in `src/` for backend logic and `app/` + `components/` for the UI.
- Local data files: `Liked_Songs.csv`, `downloads/`.
- Do not edit user data in `downloads/` unless explicitly asked.

## Package manager
- Use `pnpm` for installs and scripts.

## Install
- `pnpm install`

## Run
- `pnpm dev`

## Build
- `pnpm build`
- `pnpm start`

## Lint
- No linting tooling configured.
- If you add linting, document the exact command here.

## Tests
- No tests are currently defined.
- Keep tests colocated with sources when introduced.

## Frontend + server expectations
- Use Next.js App Router for pages and API route handlers.
- Avoid introducing a separate server framework unless required.

## TypeScript configuration
- Strict mode enabled (`strict: true`).
- `moduleResolution: bundler`.
- ESM only (`"type": "module"` in `package.json`).
- No emit (`noEmit: true`).

## Code style conventions
- Indentation: 2 spaces.
- Strings use double quotes.
- Always terminate statements with semicolons.
- Prefer trailing commas in multi-line literals.
- Keep lines readable; avoid excessive chaining.

## Imports
- Order imports as:
- 1) Node built-ins (`fs/promises`, `child_process`).
- 2) Third-party packages (`drizzle-orm`).
- 3) Local modules (`./config`).
- Use `import type` for type-only imports.
- Prefer named exports; avoid default exports unless required.

## Types
- Use `type` aliases for unions and small shapes.
- Use `interface` for exported data models (see `src/types.ts`).
- Prefer explicit return types for exported functions.
- Use discriminated unions with `kind` when modeling results.

## Naming conventions
- `camelCase` for variables, functions, and fields.
- `PascalCase` for types and interfaces.
- `UPPER_SNAKE_CASE` for constants in `src/config.ts`.
- Use descriptive names for media metadata (`trackName`, `albumName`).

## Error handling
- Check `response.ok` for fetches and throw `Error` with status details.
- Use early returns for guard conditions and empty inputs.
- Catch only when recovery is possible; log with `console.warn`.
- Preserve failure context in messages (include ids, URLs, or status).

## Async patterns
- Use `async/await` for I/O and network calls.
- Avoid mixing `then` chains with `async` functions.
- Prefer sequential `for` loops where ordering matters (see `src/index.ts`).

## Logging
- Console logging is user-facing CLI output.
- Use consistent symbols: `✓`, `✗`, `⚠️`, `⏭` already in use.
- Keep log messages short and actionable.

## File system usage
- Use `fs/promises` and `fs` for file I/O.
- Always call `ensureDirectoryExists` before writing.
- Sanitize filenames with `sanitizeFilename` when building paths.
- Use `child_process.spawn` for shell commands.

## Data and persistence
- PostgreSQL is configured via `DATABASE_URL`.
- Use `drizzle-orm` with `pg`.
- Schema management happens in `src/db.ts`.
- Keep DB interactions centralized; avoid ad hoc SQL elsewhere.

## API usage patterns
- Search API: `SEARCH_API_BASE_URL` in `src/config.ts`.
- Track API: `TRACK_API_BASE_URL` in `src/config.ts`.
- Build URLs with `encodeURIComponent` for query params.

## CSV handling
- CSV parsing is manual; preserve quoted string handling.
- Update `parseCSV` carefully; it is stateful and quote-sensitive.
- `Liked_Songs.csv` is case-sensitive and expected at repo root.

## Media download flow
- `getTrackStreamUrl` returns either a direct URL or MPD payload.
- MPD flow writes a temporary manifest and segment file.
- On successful conversion, cleanup temporary files.
- On failure, keep artifacts for inspection and log warnings.

## Adding new functionality
- Keep logic in small, testable helpers.
- Add new config constants in `src/config.ts`.
- Update `src/types.ts` for new data models.
- Keep `src/index.ts` focused on orchestration.

## Security and secrets
- Do not commit API keys or secrets.
- Prefer environment variables if new secrets are required.

## Common pitfalls
- Avoid Bun-only APIs and dependencies.
- Avoid writing into `downloads/` for tests or fixtures.

## Suggested verification steps
- Manual run: `pnpm dev`
- Smoke test: validate CSV parsing with a small sample file.
