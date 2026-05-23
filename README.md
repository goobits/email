# @goobits/email

Provider-agnostic email sender for Node, Bun, Deno, and Cloudflare Workers.
Pluggable transport interface — ships AWS SES, Resend, SMTP, and an
in-memory mock provider out of the box; bring your own implementation for
Cloudflare Email Workers or anything else that can deliver a message.

## Install

```sh
pnpm add @goobits/email
# Pick the provider you need (all are optional peer deps):
pnpm add @aws-sdk/client-sesv2  # for @goobits/email/ses
pnpm add resend                  # for @goobits/email/resend
pnpm add nodemailer              # for @goobits/email/smtp
```

`@aws-sdk/client-sesv2`, `resend`, and `nodemailer` are all **optional peer
deps** — install only the ones whose providers you import. Consumers using
a custom provider pay for none of them.

This package publishes TypeScript source entrypoints directly; no package
build step is required before importing it in TS-aware runtimes/toolchains.

## Quick start

```ts
import { createEmailService } from '@goobits/email'
import { createSesProvider } from '@goobits/email/ses'
import { SESv2Client } from '@aws-sdk/client-sesv2'

const mailer = createEmailService({
  provider: createSesProvider({ client: new SESv2Client({ region: 'us-east-1' }) }),
  from: 'no-reply@example.com',
  replyTo: 'support@example.com'
})

const result = await mailer.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<p>Hello.</p>',
  text: 'Hello.'
})

if (result.success) {
  console.log('Sent', result.messageId)
} else {
  console.error('Failed:', result.error, '(reason:', result.reason, ')')
}
```

## API

### `createEmailService(config)`

Builds an `EmailService` bound to a provider + default sender.

| Option       | Type            | Default | Notes                                                       |
|--------------|-----------------|---------|-------------------------------------------------------------|
| `provider`   | `EmailProvider` | —       | Required. The transport implementation.                     |
| `from`       | `string`        | —       | Required. Default `From` header. Overridable per-call.      |
| `replyTo`    | `string`        | —       | Optional default `Reply-To`. Overridable per-call.          |
| `logger`     | `Logger`        | noop    | Pluggable. Same interface as `@goobits/logger` / `/security`. |
| `disabled`   | `boolean`       | `false` | Kill-switch: skip provider, return `success: true`. For tests. |

Returns `EmailService`:

```ts
{
  readonly provider: EmailProvider
  send(message: EmailMessage): Promise<EmailResult>
  sendBatch(recipients: string[], message: Omit<EmailMessage, 'to'>): Promise<EmailResult[]>
  verify(): Promise<{ success: boolean; error?: string }>
}
```

### `EmailMessage`

```ts
{
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string         // Override the service default
  replyTo?: string
  cc?: string[]
  bcc?: string[]
  attachments?: {
    filename: string
    content: Uint8Array | ArrayBuffer | string  // bytes or base64 string
    contentType?: string
    inline?: boolean
    cid?: string
  }[]
  headers?: Record<string, string>
}
```

At least one of `html` or `text` must be supplied; the service and SES
provider reject messages without a body before sending. Most providers do
better when both are.

### `EmailResult`

Discriminated union — never throws on send failure, always resolves:

```ts
type EmailResult =
  | { success: true;  messageId?: string; provider: string }
  | { success: false; provider: string;   error: string;
      reason?: 'configuration-missing' | 'invalid-recipient' |
               'transport-error' | 'rate-limited' | 'unknown' }
```

### Providers

#### `createSesProvider({ client, configurationSetName? })`

AWS SES via `@aws-sdk/client-sesv2`. The consumer owns the SES client
(region, credentials, retry strategy). Uses SES v2 `SendEmailCommand` with
`Content.Simple`, so AWS handles MIME assembly server-side for attachments +
inline attachments — no hand-rolled raw MIME.

Inline attachments set `ContentDisposition: 'INLINE'` and `ContentId`;
reference them from HTML as `cid:<cid>` (`cid` defaults to the attachment
filename when omitted).

Error mapping:
- `TooManyRequestsException` / `LimitExceededException` → `reason: 'rate-limited'`
- `MessageRejected` / `BadRequestException` → `reason: 'invalid-recipient'`
- everything else → `reason: 'transport-error'`

#### `createResendProvider({ client, tag? })`

Resend via the official `resend` SDK. The consumer owns the `Resend`
client (API key, lifecycle). Supports cc/bcc, reply-to, custom headers,
attachments (`Buffer` / `Uint8Array` / base64 string content).

Pass a default `tag` to the factory to apply a Resend category to every
send (visible in the Resend dashboard for filtering/analytics). Override
per-message via `message.headers['x-resend-tag']`.

Error mapping:
- `rate_limit_exceeded` → `reason: 'rate-limited'`
- `invalid_from_address` / `validation_error` → `reason: 'invalid-recipient'`
- `missing_api_key` / `invalid_api_Key` / `missing_required_field` → `reason: 'configuration-missing'`
- everything else → `reason: 'transport-error'`

#### `createSmtpProvider({ transporter })`

SMTP / classic mail via `nodemailer`. The consumer builds the
transporter (host, port, TLS, auth, pool config) — that detail varies too
much across infrastructure to live in the package. Inline attachments
emit `cid` + `contentDisposition: 'inline'`; base64 string content is
decoded to `Buffer` to preserve byte-level fidelity.

Error mapping:
- `EAUTH` / `ECONFIGURATION` → `reason: 'configuration-missing'`
- `EENVELOPE` / SMTP 550 / 553 → `reason: 'invalid-recipient'`
- SMTP 421 / 450 / 451 / 452 → `reason: 'rate-limited'`
- everything else → `reason: 'transport-error'`

#### `createMockProvider({ failAllSends?, failureReason? })`

In-memory provider for tests. Captures every sent message:

```ts
const provider = createMockProvider()
const service = createEmailService({ provider, from: 'a@b.com' })
await service.send({ to: 'u@e.com', subject: 'hi', text: 'hi' })

provider.getSentMessages()  // → [{ to: 'u@e.com', ... }]
provider.clear()
```

Pass `{ failAllSends: true, failureReason: 'rate-limited' }` to exercise
error paths.

### Implementing your own provider

```ts
import type { EmailProvider, EmailMessage, EmailResult } from '@goobits/email'

export function createResendProvider({ apiKey }: { apiKey: string }): EmailProvider {
  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<EmailResult> {
      // Call Resend API, return success/failure result
    }
  }
}
```

Then pass it to `createEmailService({ provider: createResendProvider({...}) })`.

## What this package does NOT do

- **Template rendering** — pass pre-rendered HTML/text strings. Bring mjml,
  react-email, Svelte SSR, or plain template literals as you prefer.
- **Queueing or scheduled sends** — `send()` is synchronous in the sense
  that it awaits the provider. For high-throughput blasts, wrap with a
  job queue (BullMQ, Cloudflare Queues, etc.).
- **Bounce / complaint handling** — that's a provider-level concern
  (SES has SNS topics, Resend has webhooks). Wire those up separately.

## License

MIT
