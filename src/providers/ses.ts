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

import type { EmailAttachmentContent, EmailMessage, EmailProvider, EmailResult } from '../types.ts'

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
		if (!message.html && !message.text) {
			return buildResult(false, undefined, 'At least one of message.html or message.text is required', 'configuration-missing')
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
			let reason: 'configuration-missing' | 'rate-limited' | 'invalid-recipient' | 'transport-error' = 'transport-error'
			if (err instanceof MimeValidationError) reason = 'configuration-missing'
			else if (errorName === 'Throttling' || errorName === 'ThrottlingException') reason = 'rate-limited'
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
 * Build a minimal RFC 2822 message for `SendRawEmailCommand`. This rejects
 * CR/LF in header-bearing fields before interpolation to prevent header
 * injection. For complex needs (signed messages, nested related parts, etc.)
 * use a dedicated MIME library.
 */
function buildRawMime(message: EmailMessage, toAddresses: string[]): string {
	const boundary = `----=_Part_${ Date.now() }_${ Math.random().toString(36).slice(2) }`
	const altBoundary = `----=_Alt_${ Date.now() }_${ Math.random().toString(36).slice(2) }`

	const headers: string[] = [
		formatHeader('From', message.from ?? '', 'address'),
		formatHeader('To', toAddresses.join(', '), 'address-list'),
		formatHeader('Subject', message.subject, 'unstructured'),
		'MIME-Version: 1.0'
	]
	if (message.cc?.length) headers.push(formatHeader('Cc', message.cc.join(', '), 'address-list'))
	if (message.replyTo) headers.push(formatHeader('Reply-To', message.replyTo, 'address'))
	if (message.headers) {
		for (const [ name, value ] of Object.entries(message.headers)) {
			headers.push(formatHeader(name, value, 'unstructured'))
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
		parts.push('Content-Transfer-Encoding: base64')
		parts.push('')
		parts.push(wrapBase64(encodeUtf8Base64(message.text)))
	}
	if (message.html) {
		parts.push(`--${ altBoundary }`)
		parts.push('Content-Type: text/html; charset=UTF-8')
		parts.push('Content-Transfer-Encoding: base64')
		parts.push('')
		parts.push(wrapBase64(encodeUtf8Base64(message.html)))
	}
	parts.push(`--${ altBoundary }--`)

	// Attachments
	for (const att of message.attachments ?? []) {
		parts.push(`--${ boundary }`)
		const filename = sanitizeHeaderParameter('filename', att.filename)
		const contentType = sanitizeContentType(att.contentType ?? 'application/octet-stream')
		parts.push(`Content-Type: ${ contentType }; name="${ filename }"`)
		parts.push('Content-Transfer-Encoding: base64')
		const disposition = att.inline ? 'inline' : 'attachment'
		parts.push(`Content-Disposition: ${ disposition }; filename="${ filename }"`)
		if (att.inline) {
			const cid = sanitizeContentId(att.cid ?? att.filename)
			parts.push(`Content-ID: <${ cid }>`)
		}
		parts.push('')
		parts.push(wrapBase64(attachmentContentToBase64(att.content)))
	}

	parts.push(`--${ boundary }--`)
	return parts.join('\r\n')
}

class MimeValidationError extends Error {
	override name = 'MimeValidationError'
}

function formatHeader(name: string, value: string, mode: 'address' | 'address-list' | 'unstructured'): string {
	const safeName = sanitizeHeaderName(name)
	const safeValue = sanitizeHeaderValue(value)
	const encodedValue = mode === 'unstructured' ? encodeHeaderValue(safeValue) : safeValue
	return `${ safeName }: ${ encodedValue }`
}

function sanitizeHeaderName(name: string): string {
	if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name)) {
		throw new MimeValidationError(`Invalid email header name: ${ name }`)
	}
	return name
}

function sanitizeHeaderValue(value: string): string {
	if (/[\r\n]/.test(value)) {
		throw new MimeValidationError('Email header values must not contain CR or LF characters')
	}
	return value
}

function sanitizeHeaderParameter(name: string, value: string): string {
	if (/[\r\n"\\]/.test(value)) {
		throw new MimeValidationError(`Invalid email ${ name } parameter`)
	}
	return value
}

function sanitizeContentType(value: string): string {
	if (/[\r\n;]/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value)) {
		throw new MimeValidationError(`Invalid attachment content type: ${ value }`)
	}
	return value
}

function sanitizeContentId(value: string): string {
	if (/[\r\n<>]/.test(value) || value.trim() === '') {
		throw new MimeValidationError('Invalid inline attachment content id')
	}
	return value
}

function encodeHeaderValue(value: string): string {
	if (/^[\x20-\x7E]*$/.test(value)) return value
	return `=?UTF-8?B?${ encodeUtf8Base64(value) }?=`
}

function encodeUtf8Base64(value: string): string {
	return bytesToBase64(new TextEncoder().encode(value))
}

function attachmentContentToBase64(content: EmailAttachmentContent): string {
	if (typeof content === 'string') return content
	if (content instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(content))
	return bytesToBase64(content)
}

function bytesToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64')
	}

	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}

function wrapBase64(value: string): string {
	return value.replace(/\s+/g, '').replace(/(.{76})/g, '$1\r\n')
}
