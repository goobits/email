/**
 * SMTP provider — wraps `nodemailer`'s transport. Caller constructs the
 * transporter (so connection pooling, TLS, auth strategy all live in
 * consumer code). The provider invokes `sendMail()` and translates the
 * result into the discriminated `EmailResult` shape.
 *
 * @module @goobits/email/smtp
 */

import type { Transporter } from 'nodemailer'

import type { EmailAttachmentContent, EmailMessage, EmailProvider, EmailResult } from '../types.ts'

export interface SmtpProviderOptions {
	/**
	 * Pre-built nodemailer transporter. The consumer owns host/port/auth/TLS,
	 * pool config, and the transporter's lifecycle.
	 *
	 * @example
	 * ```ts
	 * import nodemailer from 'nodemailer'
	 *
	 * const transporter = nodemailer.createTransport({
	 *   host: 'smtp.example.com',
	 *   port: 587,
	 *   auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
	 *   pool: true
	 * })
	 * ```
	 */
	transporter: Transporter
}

/**
 * Build an SMTP-backed `EmailProvider`.
 *
 * @example
 * ```ts
 * import nodemailer from 'nodemailer'
 * import { createSmtpProvider } from '@goobits/email/smtp'
 *
 * const provider = createSmtpProvider({
 *   transporter: nodemailer.createTransport({ host, port, auth })
 * })
 * ```
 */
export function createSmtpProvider(options: SmtpProviderOptions): EmailProvider {
	const { transporter } = options

	type FailureReason = NonNullable<Extract<EmailResult, { success: false }>['reason']>

	function buildResult(
		success: boolean,
		messageId?: string,
		error?: string,
		reason?: FailureReason
	): EmailResult {
		if (success && messageId) {
			return { success: true, messageId, provider: 'smtp' }
		}
		return {
			success: false,
			provider: 'smtp',
			error: error ?? 'SMTP send failed without an error message',
			reason: reason ?? 'transport-error'
		}
	}

	async function send(message: EmailMessage): Promise<EmailResult> {
		if (!message.from) {
			return buildResult(
				false,
				undefined,
				'message.from is required (no service default supplied)',
				'configuration-missing'
			)
		}
		const toAddresses = Array.isArray(message.to) ? message.to : [message.to]
		if (toAddresses.length === 0) {
			return buildResult(false, undefined, 'No recipients supplied', 'invalid-recipient')
		}
		if (!message.html && !message.text) {
			return buildResult(
				false,
				undefined,
				'At least one of message.html or message.text is required',
				'configuration-missing'
			)
		}

		try {
			const result = await transporter.sendMail({
				from: message.from,
				to: toAddresses,
				subject: message.subject,
				...(message.html ? { html: message.html } : {}),
				...(message.text ? { text: message.text } : {}),
				...(message.cc?.length ? { cc: message.cc } : {}),
				...(message.bcc?.length ? { bcc: message.bcc } : {}),
				...(message.replyTo ? { replyTo: message.replyTo } : {}),
				...(message.headers ? { headers: message.headers } : {}),
				...(message.attachments?.length
					? { attachments: message.attachments.map(buildAttachment) }
					: {})
			})
			return buildResult(true, result.messageId)
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err)
			const code = (err as { code?: string; responseCode?: number } | undefined)?.code ?? ''
			const responseCode = (err as { responseCode?: number } | undefined)?.responseCode
			let reason: FailureReason = 'transport-error'
			// nodemailer surfaces SMTP error codes via `responseCode`. Map common ones:
			//   4xx — transient (rate limit, mailbox full, greylisting)
			//   5xx — permanent (bad recipient, auth failure, policy)
			// nodemailer v7+ renamed the invalid-config code from 'ECONFIGURATION' (v6)
			// to 'ECONFIG' (centralized in nodemailer/lib/errors.js). Accept both so the
			// mapping survives the major bump and any consumer still on an older transport.
			if (code === 'EAUTH' || code === 'ECONFIG' || code === 'ECONFIGURATION')
				reason = 'configuration-missing'
			else if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553)
				reason = 'invalid-recipient'
			else if (
				responseCode === 421 ||
				responseCode === 450 ||
				responseCode === 451 ||
				responseCode === 452
			)
				reason = 'rate-limited'
			return buildResult(false, undefined, error, reason)
		}
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		try {
			await transporter.verify()
			return { success: true }
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : String(err) }
		}
	}

	return { name: 'smtp', send, verify }
}

function buildAttachment(attachment: NonNullable<EmailMessage['attachments']>[number]) {
	return {
		filename: attachment.filename,
		content: attachmentContentToNodemailer(attachment.content),
		...(attachment.contentType ? { contentType: attachment.contentType } : {}),
		...(attachment.inline
			? {
					cid: attachment.cid ?? attachment.filename,
					contentDisposition: 'inline' as const
				}
			: {})
	}
}

function attachmentContentToNodemailer(content: EmailAttachmentContent): Buffer | string {
	// nodemailer accepts Buffer or string. Strings are treated as raw content,
	// not base64 — but our `EmailAttachment.content` string semantics specify
	// base64, so decode to Buffer to preserve byte-level fidelity.
	if (typeof content === 'string') return Buffer.from(content, 'base64')
	if (content instanceof ArrayBuffer) return Buffer.from(content)
	return Buffer.from(content)
}
