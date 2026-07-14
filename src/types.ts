/**
 * Type definitions for the pluggable email sender. The `EmailProvider`
 * interface here is what the package's `EmailService` calls — implement it
 * to back the service with any transport (AWS SES, Resend, SMTP, Cloudflare
 * Email Workers, an in-memory mock for tests).
 *
 * @module @goobits/email
 */

/** A single mail recipient — a bare address or `Name <addr@host>`. */
export type EmailAddress = string

/** Attachment bytes or a pre-encoded base64 string. */
export type EmailAttachmentContent = Uint8Array | ArrayBuffer | string

/** A file attachment. `content` may be bytes or a base64 string. */
export interface EmailAttachment {
	filename: string
	content: EmailAttachmentContent
	contentType?: string
	/** Set to true to attach inline. Reference it from HTML via `cid:<cid>`. */
	inline?: boolean
	/** Content-ID for inline attachments. Defaults to `filename` when omitted. */
	cid?: string
}

interface EmailMessageEnvelope {
	to: EmailAddress | EmailAddress[]
	subject: string
	/** Override the configured `from` for this send. */
	from?: EmailAddress
	replyTo?: EmailAddress
	cc?: EmailAddress[]
	bcc?: EmailAddress[]
	attachments?: EmailAttachment[]
	/** Free-form headers (provider-dependent — not all support custom headers). */
	headers?: Record<string, string>
}

type EmailMessageContent = { html: string; text?: string } | { text: string; html?: string }

/**
 * Inputs to a single `send` call. At least one of `html` or `text` must
 * be provided; passing both is recommended (clients pick best fit).
 */
export type EmailMessage = EmailMessageEnvelope & EmailMessageContent

/**
 * Discriminated result. `success: true` carries the provider-assigned
 * `messageId` (when available); `success: false` carries a human-readable
 * `error` plus an optional machine-readable `reason` so callers can branch
 * without parsing strings.
 */
export type EmailResult =
	| { success: true; messageId?: string; provider: string }
	| {
			success: false
			provider: string
			error: string
			reason?:
				| 'configuration-missing'
				| 'invalid-recipient'
				| 'transport-error'
				| 'rate-limited'
				| 'unknown'
	  }

/**
 * Pluggable email transport. Implement this to back `EmailService` with
 * any provider. Providers MUST resolve (never reject) with `EmailResult` —
 * callers should not have to wrap every `send()` in try/catch.
 */
export interface EmailProvider {
	/** Short identifier for logs + result metadata (e.g. `'aws-ses'`, `'mock'`). */
	readonly name: string
	/** Send a single message. */
	send(message: EmailMessage): Promise<EmailResult>
	/** Optional connectivity / credentials check. */
	verify?(): Promise<{ success: boolean; error?: string }>
}
