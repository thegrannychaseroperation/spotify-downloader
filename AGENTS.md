# AGENTS

This file orients coding agents working in this repo.
Keep guidance aligned with current code and tooling.

## Repository overview
- Runtime: Bun + TypeScript (ESM).
- Source lives in `src/` and is executed directly with Bun.
- No build step or bundler configured in `package.json`.
- Local data files: `Liked_Songs.csv`, `.cache/download-cache.sqlite`, `downloads/`.
- Do not edit user data in `downloads/` or `.cache/` unless explicitly asked.

## Required rules (Cursor)
- Default to Bun instead of Node.js.
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of `jest` or `vitest`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
- Use `bun install` instead of `npm install` or `pnpm install`.
- Use `bun run <script>` instead of `npm run <script>`.
- Use `bunx <package> <command>` instead of `npx <package> <command>`.
- Bun automatically loads `.env`, so do not add dotenv.
- Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`, `bun:sqlite`).

## Install
- `bun install`

## Run
- Main entry: `bun run src/index.ts`
- Direct file execution is acceptable: `bun src/index.ts`

## Build
- No build scripts are defined.
- If a build is needed for experiments, use Bun’s bundler:
- Example: `bun build src/index.ts --outdir dist`

## Lint
- No linting tooling configured.
- If you add linting, document the exact command here.

## Tests
- No tests are currently defined.
- Run all tests (when added): `bun test`
- Run a single test file: `bun test path/to/file.test.ts`
- Keep tests colocated with sources when introduced.

## TypeScript configuration
- Strict mode enabled (`strict: true`).
- `moduleResolution: bundler` and `allowImportingTsExtensions: true`.
- ESM only (`"type": "module"` in `package.json`).
- No emit (`noEmit: true`); run directly via Bun.

## Code style conventions
- Indentation: 2 spaces.
- Strings use double quotes.
- Always terminate statements with semicolons.
- Prefer trailing commas in multi-line literals.
- Keep lines readable; avoid excessive chaining.

## Imports
- Order imports as:
- 1) Node/Bun built-ins (`fs/promises`, `bun:sqlite`).
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
- Prefer `Bun.file` / `Bun.write` for file I/O.
- Use `fs/promises` only for tasks not covered by Bun APIs (mkdir/unlink).
- Always call `ensureDirectoryExists` before writing.
- Sanitize filenames with `sanitizeFilename` when building paths.

## Data and persistence
- SQLite cache is stored at `.cache/download-cache.sqlite`.
- Use `drizzle-orm` with `bun:sqlite`.
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
- Do not invoke Node-only APIs; stick with Bun.
- Avoid adding bundlers (Vite/Webpack) unless explicitly requested.
- Avoid writing into `downloads/` for tests or fixtures.

## Suggested verification steps
- Manual run: `bun run src/index.ts`
- Smoke test: validate CSV parsing with a small sample file.
- For future tests: add a minimal `*.test.ts` and run `bun test`.
