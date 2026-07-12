# Changelog

## Unreleased

### Changed

- Updated all dependencies to their latest versions: `@aws-sdk/client-sesv2`
  3.1074, `nodemailer` 9, `resend` 6, `typescript` 6, `@types/node` 26,
  `@types/nodemailer` 8, `vitest` 4.1.
- Declared the Vitest V8 coverage provider directly so standalone coverage
  runs do not depend on a parent workspace installation.
- Aligned the declared pnpm toolchain with the consuming workspace.
- Widened peer-dependency ranges to match the tested majors: `nodemailer`
  `^9.0.0`, `resend` `^6.0.0`, `typescript` `^5.0.0 || ^6.0.0`.
  (`@aws-sdk/client-sesv2` stays `^3.0.0`.)

### Fixed

- Resend provider: the `invalid_api_key` error now maps to
  `configuration-missing`. Resend v6 renamed this code from `invalid_api_Key`
  (the prior odd casing), which had silently turned the mapping into a dead
  branch.
- SMTP provider: nodemailer's `ECONFIG` error now maps to
  `configuration-missing`. nodemailer v7 renamed it from `ECONFIGURATION`;
  both spellings are accepted so the mapping survives the upgrade and still
  works with older transports.

## 1.0.0

Initial release.

- `createEmailService` — provider-agnostic service factory with `send` /
  `sendBatch` / `verify`
- `createSesProvider` — AWS SES provider via `@aws-sdk/client-sesv2`. Uses
  SES v2 `SendEmail` with `Content.Simple.Attachments`, so AWS handles MIME
  assembly server-side. Supports plain text + HTML bodies, cc/bcc, reply-to,
  configuration sets, custom headers, attachments, and inline attachments
  with Content-ID.
- `createResendProvider` — Resend provider via the official `resend` SDK.
  Supports per-call tags via the `x-resend-tag` header for category-based
  filtering in the Resend dashboard.
- `createSmtpProvider` — SMTP / classic mail provider via `nodemailer`.
  Consumer owns the transporter (host, TLS, auth, pool config).
- `createMockProvider` — in-memory provider for tests; exposes
  `getSentMessages()` + `clear()` for assertions and reset
- Pluggable `Logger` interface (matches `@goobits/logger`, `/security`, `/sitemap`)
- Discriminated `EmailResult` union — providers never throw, always return a
  typed result; failed sends include a machine-readable `reason` for branching
- Discriminated `EmailMessage` body union — enforces at-least-one-of
  `html`/`text` at the type level
- Pre-send validation: missing `from`, empty recipients, missing body all
  produce typed `configuration-missing` / `invalid-recipient` results before
  any provider call
- SES header / attachment validation: rejects CR/LF in header-bearing
  fields, validates header names + content types, validates inline
  `ContentId` shape
- All provider peer deps (`@aws-sdk/client-sesv2`, `resend`, `nodemailer`)
  are optional; install only the SDKs whose providers you import
