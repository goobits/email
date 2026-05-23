/**
 * AWS SES v2 provider — preferred SES transport for production use.
 * Uses SES v2 `SendEmail` with `Content.Simple.Attachments`, so AWS owns
 * MIME assembly for normal transactional emails with attachments/inline CIDs.
 *
 * @module @goobits/email/sesv2
 */

import type { SESv2Client } from '@aws-sdk/client-sesv2'
import { SendEmailCommand } from '@aws-sdk/client-sesv2'

import type { EmailAttachmentContent, EmailMessage, EmailProvider, EmailResult } from '../types.ts'

export interface SesV2ProviderOptions {
	/**
	 * Pre-built SES v2 client. The consumer owns region, credentials,
	 * retry strategy, and lifecycle.
	 */
	client: SESv2Client
	/**
	 * Optional configuration set name (SES feature for event publishing,
	 * dedicated IPs, etc). Forwarded as `ConfigurationSetName` on every send.
	 */
	configurationSetName?: string
}

/**
 * Build an SES v2-backed `EmailProvider`.
 *
 * @example
 * ```ts
 * import { SESv2Client } from '@aws-sdk/client-sesv2'
 * import { createSesV2Provider } from '@goobits/email/sesv2'
 *
 * const provider = createSesV2Provider({
 *   client: new SESv2Client({ region: 'us-east-1' })
 * })
 * ```
 */
export function createSesV2Provider(options: SesV2ProviderOptions): EmailProvider {
	const { client, configurationSetName } = options

	type FailureReason = NonNullable<Extract<EmailResult, { success: false }>['reason']>

	function buildResult(
		success: boolean,
		messageId?: string,
		error?: string,
		reason?: FailureReason
	): EmailResult {
		if (success && messageId) {
			return { success: true, messageId, provider: 'aws-ses-v2' }
		}
		return {
			success: false,
			provider: 'aws-ses-v2',
			error: error ?? 'SES v2 send failed without an error message',
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

		try {
			const command = new SendEmailCommand({
				FromEmailAddress: message.from,
				Destination: {
					ToAddresses: toAddresses,
					...(message.cc?.length ? { CcAddresses: message.cc } : {}),
					...(message.bcc?.length ? { BccAddresses: message.bcc } : {})
				},
				Content: {
					Simple: {
						Subject: { Data: message.subject, Charset: 'UTF-8' },
						Body: {
							...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
							...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {})
						},
						...(message.headers ? { Headers: buildHeaders(message.headers) } : {}),
						...(message.attachments?.length ? { Attachments: message.attachments.map(buildAttachment) } : {})
					}
				},
				...(message.replyTo ? { ReplyToAddresses: [ message.replyTo ] } : {}),
				...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {})
			})
			const result = await client.send(command)
			return buildResult(true, result.MessageId)
		} catch(err) {
			const error = err instanceof Error ? err.message : String(err)
			const errorName = err instanceof Error ? err.name : ''
			let reason: 'configuration-missing' | 'rate-limited' | 'invalid-recipient' | 'transport-error' = 'transport-error'
			if (err instanceof SesV2ValidationError) reason = 'configuration-missing'
			else if (errorName === 'TooManyRequestsException' || errorName === 'LimitExceededException') reason = 'rate-limited'
			else if (errorName === 'MessageRejected' || errorName === 'BadRequestException') reason = 'invalid-recipient'
			return buildResult(false, undefined, error, reason)
		}
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		if (!client) return { success: false, error: 'SES v2 client not provided' }
		return { success: true }
	}

	return { name: 'aws-ses-v2', send, verify }
}

class SesV2ValidationError extends Error {
	override name = 'SesV2ValidationError'
}

function buildHeaders(headers: Record<string, string>): Array<{ Name: string; Value: string }> {
	return Object.entries(headers).map(([ name, value ]) => {
		const safeName = validateHeaderName(name)
		const safeValue = validateHeaderValue(value)
		return { Name: safeName, Value: safeValue }
	})
}

function buildAttachment(attachment: NonNullable<EmailMessage['attachments']>[number]) {
	return {
		FileName: validateAttachmentFilename(attachment.filename),
		RawContent: attachmentContentToBytes(attachment.content),
		...(attachment.contentType ? { ContentType: validateContentType(attachment.contentType) } : {}),
		ContentDisposition: attachment.inline ? 'INLINE' as const : 'ATTACHMENT' as const,
		...(attachment.inline ? { ContentId: validateContentId(attachment.cid ?? attachment.filename) } : {}),
		ContentTransferEncoding: 'BASE64' as const
	}
}

function validateHeaderName(name: string): string {
	if (name.length === 0 || name.length > 126 || !/^[\x21-\x39\x3B-\x7E]+$/.test(name)) {
		throw new SesV2ValidationError(`Invalid email header name: ${ name }`)
	}
	return name
}

function validateHeaderValue(value: string): string {
	if (value.length > 995 || !/^[\x20-\x7E]*$/.test(value)) {
		throw new SesV2ValidationError('Email header values must be printable ASCII and at most 995 characters')
	}
	return value
}

function validateAttachmentFilename(filename: string): string {
	if (filename.trim() === '' || /[\r\n]/.test(filename)) {
		throw new SesV2ValidationError('Attachment filename must not be empty or contain CR/LF characters')
	}
	return filename
}

function validateContentType(value: string): string {
	if (/[\r\n;]/.test(value) || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value)) {
		throw new SesV2ValidationError(`Invalid attachment content type: ${ value }`)
	}
	return value
}

function validateContentId(value: string): string {
	if (/[\r\n<>]/.test(value) || value.trim() === '') {
		throw new SesV2ValidationError('Invalid inline attachment content id')
	}
	return value
}

function attachmentContentToBytes(content: EmailAttachmentContent): Uint8Array {
	if (typeof content === 'string') return base64ToBytes(content)
	if (content instanceof ArrayBuffer) return new Uint8Array(content)
	return content
}

function base64ToBytes(value: string): Uint8Array {
	const normalized = value.replace(/\s+/g, '')
	if (normalized === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
		throw new SesV2ValidationError('Attachment string content must be valid base64')
	}

	if (typeof Buffer !== 'undefined') {
		return new Uint8Array(Buffer.from(normalized, 'base64'))
	}

	const binary = atob(normalized)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}
