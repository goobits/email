# Changelog

## 1.0.0

Initial release.

- `createEmailService` — provider-agnostic service factory with `send` /
  `sendBatch` / `verify`
- `createSesProvider` — AWS SES provider (`@aws-sdk/client-ses` v3 peer dep)
- `createMockProvider` — in-memory provider for tests
- Pluggable `Logger` interface (matches `@goobits/logger`, `/security`, `/sitemap`)
- Discriminated `EmailResult` union — providers never throw, always return a
  typed result; failed sends include a machine-readable `reason` for branching
