# Changelog

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
