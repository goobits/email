# `@goobits/email` Agent Guide

Provider-agnostic email sender for Node, Bun, Deno, and Cloudflare Workers.
Notes here describe code that agents/contributors should follow when
modifying this package.

---

## Quick reference

- **Category:** library (ESM-only, TypeScript)
- **Distribution:** git submodule consumed inside a pnpm workspace. Consumer bundlers (Vite/esbuild/SvelteKit) compile the `.ts` source directly — no build step, no `dist/`, no npm publish.
- **Primary stack:** TypeScript 5.9 + vitest. Zero runtime dependencies. Optional peer-deps: `@aws-sdk/client-ses ^3` (only when using `/ses`), `typescript ^5`.
- **Runtime targets:** Node 22+, Bun, Deno, Cloudflare Workers (anything supporting `Promise` + the chosen provider's runtime contract).
- **Engines:** Node `>=22`

## Commands

```bash
pnpm install
pnpm typecheck      # tsc --noEmit (src + tests)
pnpm test           # vitest run
pnpm test:watch     # vitest
pnpm test:coverage  # vitest run --coverage
```

## Architecture

```
src/
├── index.ts            # barrel: types + service + mock provider
├── types.ts            # EmailMessage, EmailResult, EmailProvider interface
├── logger.ts           # pluggable Logger interface + noopLogger
├── service.ts          # createEmailService — defaults, fan-out, disable switch
└── providers/
    ├── ses.ts          # AWS SES v2 (@aws-sdk/client-sesv2, SendEmailCommand + Content.Simple)
    ├── resend.ts       # Resend (resend SDK)
    ├── smtp.ts         # SMTP / classic mail (nodemailer)
    └── mock.ts         # in-memory provider for tests
```

`package.json#exports` points directly at `./src/*.ts`. There is no build step. Consumers' bundlers (Vite/esbuild/SvelteKit) compile the `.ts` source as part of their own pipeline.

`@goobits/email` (root barrel) ships only zero-dep code (types + service + mock). Provider-specific subpaths (`/ses`, `/resend`, `/smtp`) live in their own files so consumers don't transitively pull SDKs they don't use.

## Code style

- Tabs, single quotes, no semicolons
- Strict TypeScript (`tsconfig.json` enables `noUncheckedIndexedAccess`, `noUnusedLocals`, etc.)
- All exports named; no default exports
- Use the `_internal/` directory for any helper that should NOT appear in the public API

## Design rules (do not bypass)

- **Providers MUST resolve, never reject.** Every `EmailProvider.send()` returns a `Promise<EmailResult>` — failures are reported via `{ success: false, error, reason }`, not exceptions. Callers should never need to wrap `send()` in try/catch. This is the load-bearing invariant of the package — breaking it forces every consumer to add error handling at every call site.
- **`EmailResult.reason` is a closed enum, not a string.** Adding a new failure category requires extending the union in `types.ts` and updating provider mappings. Don't pass through provider-specific error codes as `reason` — they belong in `error` (the human-readable message).
- **The package owns NO template logic.** `html` and `text` are strings the caller has already rendered. Don't add `template:` / `templateName:` options that bind the package to a specific render engine. (Consumer apps may layer a renderer on top — that's their concern.)
- **Provider-specific config stays in the provider factory.** `createSesProvider({ client, configurationSetName })` not `createEmailService({ ses: {...} })`. This keeps the service layer free of provider knowledge.
- **No transitive SDK deps.** If a provider needs an external SDK, it lives in a subpath (`/ses`) with the SDK as an optional peer dep. The root barrel must remain dep-free.
- **`from` is required at send time.** Either via service default (`createEmailService({ from })`) or per-message (`message.from`). Providers that receive a message without `from` MUST return `{ success: false, reason: 'configuration-missing' }`.
- **When this package's deps change in `package.json`, verify their licenses remain permissive (MIT / Apache 2.0 / BSD).** No GPL-ish copyleft deps.

## Project-specific overrides

- **`@goobits/logger` is intentionally not a dependency.** Use the local pluggable `Logger` interface from `./logger.js` (identical shape to `@goobits/security` / `/sitemap` / `/logger`). Consumers wanting structured logging pass a logger instance in.
- **Mock provider exposes `getSentMessages()` + `clear()` directly on the returned object** (rather than via a separate "test utils" subpath). Tests are first-class consumers; making them awkward isn't paying for anything.
- **`sendBatch` fans out sequentially.** Don't parallelize. SES throttles per-second and naïve `Promise.all` over 50 recipients trips throughput limits. Callers wanting concurrency can map `recipients` themselves with `Promise.all` + a chunking strategy.

## Where to look

- Public API barrel: `src/index.ts`
- Per-capability module: `src/<name>.ts` or `src/providers/<name>.ts`
- Tests for each module: `tests/<topic>.test.ts`
- Test config: `vitest.config.ts`
- Types-strict config: `tsconfig.json`

## Definition of Done

- `pnpm typecheck` passes with no errors (covers `src/` and `tests/`)
- `pnpm test` passes with no failing assertions
- Every entry in `package.json#exports` points at an existing `src/*.ts` file
- No `dist/`, `node_modules/`, `.DS_Store`, or `*.tsbuildinfo` tracked
- README + CHANGELOG updated for any user-facing change
- The `EmailProvider` interface shape (one `send` method + optional `verify`) is unchanged
- New deps reviewed for license compatibility (permissive only)

## Shared-Folder Git

- Shared macOS/Linux checkouts should use `core.filemode=false`; chmod-only changes will not be noticed reliably.
- When a script must be executable, run `git update-index --chmod=+x path/to/script.sh` and include that in the commit.
