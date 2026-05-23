# @goobits/email

Provider-agnostic email sender for Node, Bun, Deno, and Cloudflare Workers.
Pluggable transport interface — ships AWS SES v2, legacy AWS SES, and an
in-memory mock provider; bring your own implementations for Resend, SMTP,
Cloudflare Email Workers, or anything else that can deliver a message.

## Install

```sh
pnpm add @goobits/email
# AWS SES v2 users (recommended):
pnpm add @aws-sdk/client-sesv2
# Legacy AWS SES users:
pnpm add @aws-sdk/client-ses
```

`@aws-sdk/client-sesv2` and `@aws-sdk/client-ses` are **optional peer deps**.
They are only required if you import `@goobits/email/sesv2` or
`@goobits/email/ses`. Consumers using Resend / SMTP / a custom provider don't
pay for them.

This package publishes TypeScript source entrypoints directly; no package
build step is required before importing it in TS-aware runtimes/toolchains.

## Quick start

```ts
import { createEmailService } from '@goobits/email'
import { createSesV2Provider } from '@goobits/email/sesv2'
import { SESv2Client } from '@aws-sdk/client-sesv2'

const mailer = createEmailService({
  provider: createSesV2Provider({ client: new SESv2Client({ region: 'us-east-1' }) }),
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

#### `createSesV2Provider({ client, configurationSetName? })`

Recommended AWS SES provider via `@aws-sdk/client-sesv2` v3. The consumer owns
the SES v2 client (region, credentials, retry strategy). Uses SES v2
`SendEmailCommand` with `Content.Simple`, including SES-managed attachments and
inline attachments.

This provider avoids raw MIME construction for the package's normal feature
set. Attachments are passed through SES v2 attachment objects; inline
attachments set `ContentDisposition: 'INLINE'` and `ContentId`, so reference
them from HTML as `cid:<cid>`.

Maps known SES v2 errors:
- `TooManyRequestsException` / `LimitExceededException` → `reason: 'rate-limited'`
- `MessageRejected` / `BadRequestException` → `reason: 'invalid-recipient'`
- everything else → `reason: 'transport-error'`

#### `createSesProvider({ client, configurationSetName? })`

Legacy AWS SES provider via `@aws-sdk/client-ses` v3. The consumer owns the SES
client (region, credentials, retry strategy). Uses `SendEmailCommand` for
attachment-free messages and `SendRawEmailCommand` (RFC 2822 raw MIME) when
attachments or custom headers are present.

The raw MIME path rejects CR/LF in header-bearing fields and validates
custom header names before sending. Inline attachments emit `Content-ID`;
set `cid` explicitly and reference it from HTML as `cid:<cid>`.

Maps known SES errors:
- `Throttling` / `ThrottlingException` → `reason: 'rate-limited'`
- `MessageRejected` → `reason: 'invalid-recipient'`
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
