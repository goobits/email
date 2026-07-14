/**
 * @goobits/email
 *
 * Provider-agnostic email sender. The main barrel re-exports the
 * service factory, mock provider, types, and logger interface.
 * Provider implementations with peer-dep requirements live in their
 * own subpaths so consumers don't pay for unused providers:
 *
 *   - `@goobits/email`         — types + service + mock provider (no deps)
 *   - `@goobits/email/ses`     — AWS SES v2 provider (peer: @aws-sdk/client-sesv2)
 *   - `@goobits/email/resend`  — Resend provider (peer: resend)
 *   - `@goobits/email/smtp`    — SMTP provider (peer: nodemailer)
 *
 * @module @goobits/email
 */

export {
	type BatchMessage,
	type EmailService,
	type EmailServiceConfig,
	createEmailService
} from './service.ts'

export { type Logger, type LogContext, noopLogger } from './logger.ts'

export {
	type EmailAddress,
	type EmailAttachment,
	type EmailMessage,
	type EmailProvider,
	type EmailResult
} from './types.ts'

export {
	type MockProvider,
	type MockProviderOptions,
	createMockProvider
} from './providers/mock.ts'
