/**
 * EmailService — the consumer-facing surface. Holds a provider + default
 * sender config and exposes `send()` / `sendBatch()` / `verify()`.
 *
 * The service intentionally does NOT generate templates. Callers pass
 * `html` / `text` strings directly. Template rendering (mjml, react-email,
 * Svelte SSR, plain string interpolation) is a separable concern that
 * lives in the consumer.
 *
 * @module @goobits/email
 */

import { type Logger, resolveLogger } from './logger.ts'
import type { EmailMessage, EmailProvider, EmailResult } from './types.ts'

export interface EmailServiceConfig {
	/** Backing transport. Required. */
	provider: EmailProvider
	/** Default `From` address. Used when an individual message omits `from`. */
	from: string
	/** Default `Reply-To`. Individual messages may override. */
	replyTo?: string
	/** Pluggable logger. Default: silent. */
	logger?: Logger
	/**
	 * Bypass actual sending. When true, `send()` returns
	 * `{ success: true, provider: 'disabled' }` immediately and emits a
	 * `warn` log. Use for E2E tests or kill-switch toggles.
	 */
	disabled?: boolean
}

/**
 * The send-side options that vary per-call. Subset of `EmailMessage`
 * (you don't pass the recipient through `sendBatch` — see below).
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

export type BatchMessage = DistributiveOmit<EmailMessage, 'to'>

export interface EmailService {
	readonly provider: EmailProvider
	send(message: EmailMessage): Promise<EmailResult>
	/**
	 * Send the same content to N recipients. One provider call per recipient
	 * (so per-recipient personalization can be added by mapping the array
	 * first). For large blast sends, you probably want a different abstraction
	 * (queue + worker) — this is for handful-of-recipients fan-out.
	 */
	sendBatch(recipients: string[], message: BatchMessage): Promise<EmailResult[]>
	verify(): Promise<{ success: boolean; error?: string }>
}

/**
 * Create an `EmailService` bound to a provider + default sender config.
 *
 * @example
 * ```ts
 * import { createEmailService } from '@goobits/email'
 * import { createSesProvider } from '@goobits/email/ses'
 *
 * const mailer = createEmailService({
 *   provider: createSesProvider({ region: 'us-east-1' }),
 *   from: 'no-reply@example.com'
 * })
 *
 * const result = await mailer.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome',
 *   html: '<p>Hello.</p>',
 *   text: 'Hello.'
 * })
 * ```
 */
export function createEmailService(config: EmailServiceConfig): EmailService {
	const log = resolveLogger(config.logger)
	const { provider, from, replyTo, disabled = false } = config

	function applyDefaults(message: EmailMessage): EmailMessage {
		// `EmailMessage` is a discriminated union (`{html: string, text?: string}`
		// | `{text: string, html?: string}`). Spreading widens both html/text
		// to `string | undefined`, breaking the narrowing — but the incoming
		// `message` is already a valid `EmailMessage`, so the spread output is
		// too. Cast to bypass the inference limitation; runtime shape is unchanged.
		const out = {
			...message,
			from: message.from ?? from
		} as EmailMessage
		if (replyTo && !message.replyTo) out.replyTo = replyTo
		return out
	}

	function hasBodyContent(message: EmailMessage | BatchMessage): boolean {
		return Boolean(message.html || message.text)
	}

	async function send(message: EmailMessage): Promise<EmailResult> {
		if (disabled) {
			log.warn('Email send bypassed (service is disabled)', {
				to: Array.isArray(message.to) ? message.to.join(',') : message.to,
				subject: message.subject
			})
			return { success: true, provider: 'disabled' }
		}

		const prepared = applyDefaults(message)
		if (!hasBodyContent(prepared)) {
			const result: EmailResult = {
				success: false,
				provider: provider.name,
				error: 'At least one of message.html or message.text is required',
				reason: 'configuration-missing'
			}
			log.error('Email send failed', {
				provider: provider.name,
				to: Array.isArray(prepared.to) ? prepared.to.join(',') : prepared.to,
				subject: prepared.subject,
				error: result.error,
				reason: result.reason
			})
			return result
		}
		const result = await provider.send(prepared)
		if (result.success) {
			log.info('Email sent', {
				provider: provider.name,
				to: Array.isArray(prepared.to) ? prepared.to.join(',') : prepared.to,
				subject: prepared.subject,
				messageId: result.messageId
			})
		} else {
			log.error('Email send failed', {
				provider: provider.name,
				to: Array.isArray(prepared.to) ? prepared.to.join(',') : prepared.to,
				subject: prepared.subject,
				error: result.error,
				reason: result.reason
			})
		}
		return result
	}

	async function sendBatch(recipients: string[], message: BatchMessage): Promise<EmailResult[]> {
		if (recipients.length === 0) return []
		// Fan out sequentially — most providers throttle per-second; firing
		// 100 concurrent SES calls can trip throughput limits. Callers that
		// want concurrency can map `recipients` themselves with `Promise.all`.
		const results: EmailResult[] = []
		for (const to of recipients) {
			results.push(await send({ ...message, to } as EmailMessage))
		}
		return results
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		if (!provider.verify) {
			return { success: true }
		}
		return provider.verify()
	}

	return { provider, send, sendBatch, verify }
}
