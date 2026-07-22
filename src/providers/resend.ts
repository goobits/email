/**
 * Resend provider — wraps the official `resend` SDK. Resend's modern
 * transactional-email API takes plain JSON; no MIME assembly involved.
 *
 * The consumer owns the `Resend` client lifecycle (so a single instance
 * can be shared with non-email Resend features if any).
 *
 * @module @goobits/email/resend
 */

import type { Resend } from 'resend'

import type { EmailAttachmentContent, EmailMessage, EmailProvider, EmailResult } from '../types.ts'
import {
	buildProviderMessagePayload,
	createProviderResultBuilder,
	prepareProviderMessage,
	type EmailFailureReason
} from '../_internal/providerPolicy.ts'

export interface ResendProviderOptions {
	/**
	 * Pre-built `Resend` client. The consumer owns API key + lifecycle.
	 */
	client: Resend
	/**
	 * Default Resend "tag" applied to every send. Tags surface in the
	 * Resend dashboard for filtering/analytics. Per-call tags from
	 * `message.headers['x-resend-tag']` override this.
	 */
	tag?: string
}

/**
 * Build a Resend-backed `EmailProvider`.
 *
 * @example
 * ```ts
 * import { Resend } from 'resend'
 * import { createResendProvider } from '@goobits/email/resend'
 *
 * const provider = createResendProvider({
 *   client: new Resend(process.env.RESEND_API_KEY)
 * })
 * ```
 */
export function createResendProvider(options: ResendProviderOptions): EmailProvider {
	const { client, tag } = options

	const buildResult = createProviderResultBuilder(
		'resend',
		'Resend send failed without an error message'
	)

	async function send(message: EmailMessage): Promise<EmailResult> {
		const prepared = prepareProviderMessage(message, buildResult)
		if (!prepared.ok) return prepared.result

		try {
			// Resend's `CreateEmailOptions` is `RequireAtLeastOne<{html, text, react}>
			// & CreateEmailBaseOptions`. Our conditional spreads widen html/text to
			// optional, which TypeScript can't reconcile with the AtLeastOne shape
			// even though we've already validated that one is present above.
			// Build as Record<string, unknown> + cast at the boundary.
			const payload: Record<string, unknown> = buildProviderMessagePayload(
				message,
				prepared,
				buildAttachment
			)

			if (tag || message.headers?.['x-resend-tag']) {
				payload['tags'] = [
					{ name: 'category', value: message.headers?.['x-resend-tag'] ?? tag ?? 'default' }
				]
			}

			const { data, error } = await client.emails.send(
				payload as unknown as Parameters<Resend['emails']['send']>[0]
			)

			if (error) {
				const name: string = error.name ?? ''
				let reason: EmailFailureReason = 'transport-error'
				// Resend error names — RESEND_ERROR_CODES_BY_KEY in the SDK.
				// https://resend.com/docs/api-reference/errors
				if (name === 'rate_limit_exceeded') reason = 'rate-limited'
				else if (name === 'invalid_from_address' || name === 'validation_error') {
					reason = 'invalid-recipient'
				} else if (
					name === 'missing_api_key' ||
					name === 'invalid_api_key' || // resend v6: RESEND_ERROR_CODE_KEY uses lowercase 'key'
					name === 'missing_required_field'
				) {
					reason = 'configuration-missing'
				}
				return buildResult(
					false,
					undefined,
					error.message ?? name ?? 'Unknown Resend error',
					reason
				)
			}

			return buildResult(true, data?.id)
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err)
			return buildResult(false, undefined, error, 'transport-error')
		}
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		// Resend has no cheap ping; checking client construction is the best
		// we can do without sending a real message.
		if (!client) return { success: false, error: 'Resend client not provided' }
		return { success: true }
	}

	return { name: 'resend', send, verify }
}

function buildAttachment(attachment: NonNullable<EmailMessage['attachments']>[number]) {
	return {
		filename: attachment.filename,
		content: attachmentContentToResend(attachment.content),
		...(attachment.contentType ? { contentType: attachment.contentType } : {})
	}
}

function attachmentContentToResend(content: EmailAttachmentContent): Buffer | string {
	// Resend accepts either a string (base64) or a Buffer. Pass strings through
	// as-is (assumed base64); convert Uint8Array / ArrayBuffer to Buffer.
	if (typeof content === 'string') return content
	if (content instanceof ArrayBuffer) return Buffer.from(content)
	return Buffer.from(content)
}
