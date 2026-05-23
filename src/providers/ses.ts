/**
 * AWS SES provider — wraps `@aws-sdk/client-ses` v3. Requires the SDK
 * to be installed as a peer dep in the consumer; this package does NOT
 * declare it as a hard dep to avoid forcing AWS SDK onto consumers that
 * use other providers (Resend, SMTP, etc).
 *
 * Supports both attachment-free messages (cheap SES `SendEmailCommand`)
 * and messages with attachments (RFC 2822 raw MIME via `SendRawEmailCommand`).
 *
 * @module @goobits/email/ses
 */

import type { SESClient } from '@aws-sdk/client-ses'
import { SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses'

import type { EmailMessage, EmailProvider, EmailResult } from '../types.js'

export interface SesProviderOptions {
	/**
	 * Pre-built SES client. The consumer owns the AWS SDK lifecycle —
	 * region, credentials, retry strategy, etc. all live there.
	 */
	client: SESClient
	/**
	 * Optional configuration set name (SES feature for event publishing,
	 * dedicated IPs, etc). Forwarded as `ConfigurationSetName` on every send.
	 */
	configurationSetName?: string
}

/**
 * Build an SES-backed `EmailProvider`.
 *
 * @example
 * ```ts
 * import { SESClient } from '@aws-sdk/client-ses'
 * import { createSesProvider } from '@goobits/email/ses'
 *
 * const provider = createSesProvider({
 *   client: new SESClient({ region: 'us-east-1' })
 * })
 * ```
 */
export function createSesProvider(options: SesProviderOptions): EmailProvider {
	const { client, configurationSetName } = options

	type FailureReason = NonNullable<Extract<EmailResult, { success: false }>['reason']>

	function buildResult(
		success: boolean,
		messageId?: string,
		error?: string,
		reason?: FailureReason
	): EmailResult {
		if (success && messageId) {
			return { success: true, messageId, provider: 'aws-ses' }
		}
		return {
			success: false,
			provider: 'aws-ses',
			error: error ?? 'SES send failed without an error message',
			reason: reason ?? 'transport-error'
		}
	}

	async function send(message: EmailMessage): Promise<EmailResult> {
		if (!message.from) {
			return buildResult(false, undefined, 'message.from is required (no service default supplied)', 'configuration-missing')
		}
		const toAddresses = Array.isArray(message.to) ? message.to : [ message.to ]
		if (toAddresses.length === 0) {
			return buildResult(false, undefined, 'No recipients supplied', 'invalid-recipient')
		}

		const hasAttachments = message.attachments && message.attachments.length > 0
		const hasCustomHeaders = message.headers && Object.keys(message.headers).length > 0

		try {
			// Attachments or custom headers → must use raw MIME path.
			if (hasAttachments || hasCustomHeaders) {
				const raw = buildRawMime(message, toAddresses)
				const command = new SendRawEmailCommand({
					Source: message.from,
					Destinations: [
						...toAddresses,
						...(message.cc ?? []),
						...(message.bcc ?? [])
					],
					RawMessage: { Data: new TextEncoder().encode(raw) },
					...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {})
				})
				const result = await client.send(command)
				return buildResult(true, result.MessageId)
			}

			// Simple path — no attachments, no custom headers.
			const command = new SendEmailCommand({
				Source: message.from,
				Destination: {
					ToAddresses: toAddresses,
					...(message.cc?.length ? { CcAddresses: message.cc } : {}),
					...(message.bcc?.length ? { BccAddresses: message.bcc } : {})
				},
				Message: {
					Subject: { Data: message.subject, Charset: 'UTF-8' },
					Body: {
						...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
						...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {})
					}
				},
				...(message.replyTo ? { ReplyToAddresses: [ message.replyTo ] } : {}),
				...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {})
			})
			const result = await client.send(command)
			return buildResult(true, result.MessageId)
		} catch(err) {
			const error = err instanceof Error ? err.message : String(err)
			// SES surfaces `Throttling` / `MessageRejected` as errors with names
			// that callers may want to branch on — map a couple of well-known ones.
			const errorName = err instanceof Error ? err.name : ''
			let reason: 'rate-limited' | 'invalid-recipient' | 'transport-error' = 'transport-error'
			if (errorName === 'Throttling' || errorName === 'ThrottlingException') reason = 'rate-limited'
			else if (errorName === 'MessageRejected') reason = 'invalid-recipient'
			return buildResult(false, undefined, error, reason)
		}
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		// SES doesn't have a cheap ping; sending a no-op would actually send.
		// Best we can do: confirm the client is constructed. Real verification
		// happens on first send.
		if (!client) return { success: false, error: 'SES client not provided' }
		return { success: true }
	}

	return { name: 'aws-ses', send, verify }
}

/**
 * Build a minimal RFC 2822 message for `SendRawEmailCommand`. Handles
 * single attachments and multipart/alternative HTML+text. NOT a full
 * MIME implementation — for complex needs (cid: inline images, signed
 * messages, etc.) use a dedicated library and pass the raw bytes.
 */
function buildRawMime(message: EmailMessage, toAddresses: string[]): string {
	const boundary = `----=_Part_${ Date.now() }_${ Math.random().toString(36).slice(2) }`
	const altBoundary = `----=_Alt_${ Date.now() }_${ Math.random().toString(36).slice(2) }`

	const headers: string[] = [
		`From: ${ message.from ?? '' }`,
		`To: ${ toAddresses.join(', ') }`,
		`Subject: ${ message.subject }`,
		'MIME-Version: 1.0'
	]
	if (message.cc?.length) headers.push(`Cc: ${ message.cc.join(', ') }`)
	if (message.replyTo) headers.push(`Reply-To: ${ message.replyTo }`)
	if (message.headers) {
		for (const [ name, value ] of Object.entries(message.headers)) {
			headers.push(`${ name }: ${ value }`)
		}
	}
	headers.push(`Content-Type: multipart/mixed; boundary="${ boundary }"`)

	const parts: string[] = [ headers.join('\r\n'), '' ]

	// Body part (multipart/alternative for html + text)
	parts.push(`--${ boundary }`)
	parts.push(`Content-Type: multipart/alternative; boundary="${ altBoundary }"`)
	parts.push('')
	if (message.text) {
		parts.push(`--${ altBoundary }`)
		parts.push('Content-Type: text/plain; charset=UTF-8')
		parts.push('Content-Transfer-Encoding: 7bit')
		parts.push('')
		parts.push(message.text)
	}
	if (message.html) {
		parts.push(`--${ altBoundary }`)
		parts.push('Content-Type: text/html; charset=UTF-8')
		parts.push('Content-Transfer-Encoding: 7bit')
		parts.push('')
		parts.push(message.html)
	}
	parts.push(`--${ altBoundary }--`)

	// Attachments
	for (const att of message.attachments ?? []) {
		parts.push(`--${ boundary }`)
		parts.push(`Content-Type: ${ att.contentType ?? 'application/octet-stream' }; name="${ att.filename }"`)
		parts.push('Content-Transfer-Encoding: base64')
		const disposition = att.inline ? 'inline' : 'attachment'
		parts.push(`Content-Disposition: ${ disposition }; filename="${ att.filename }"`)
		parts.push('')
		const base64 = typeof att.content === 'string' ? att.content : att.content.toString('base64')
		// Wrap at 76 chars per RFC.
		parts.push(base64.replace(/(.{76})/g, '$1\r\n'))
	}

	parts.push(`--${ boundary }--`)
	return parts.join('\r\n')
}
