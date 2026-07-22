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
import {
	buildProviderMessagePayload,
	createProviderResultBuilder,
	prepareProviderMessage,
	type EmailFailureReason
} from '../_internal/providerPolicy.ts'

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

	const buildResult = createProviderResultBuilder(
		'smtp',
		'SMTP send failed without an error message'
	)

	async function send(message: EmailMessage): Promise<EmailResult> {
		const prepared = prepareProviderMessage(message, buildResult)
		if (!prepared.ok) return prepared.result

		try {
			const result = await transporter.sendMail(
				buildProviderMessagePayload(message, prepared, buildAttachment)
			)
			return buildResult(true, result.messageId)
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err)
			const code = (err as { code?: string; responseCode?: number } | undefined)?.code ?? ''
			const responseCode = (err as { responseCode?: number } | undefined)?.responseCode
			let reason: EmailFailureReason = 'transport-error'
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
