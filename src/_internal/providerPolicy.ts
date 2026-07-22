import type { EmailMessage, EmailResult } from '../types.ts'

export const EMAIL_BODY_REQUIRED_ERROR = 'At least one of message.html or message.text is required'

export function hasEmailBodyContent(message: { html?: string; text?: string }): boolean {
	return Boolean(message.html || message.text)
}

export type EmailFailureReason = NonNullable<Extract<EmailResult, { success: false }>['reason']>

type ProviderResultBuilder = (
	success: boolean,
	messageId?: string,
	error?: string,
	reason?: EmailFailureReason
) => EmailResult

export function createProviderResultBuilder(
	provider: string,
	fallbackError: string
): ProviderResultBuilder {
	return (success, messageId, error, reason) => {
		if (success && messageId) {
			return { success: true, messageId, provider }
		}
		return {
			success: false,
			provider,
			error: error ?? fallbackError,
			reason: reason ?? 'transport-error'
		}
	}
}

export function prepareProviderMessage(message: EmailMessage, buildResult: ProviderResultBuilder) {
	if (!message.from) {
		return {
			ok: false as const,
			result: buildResult(
				false,
				undefined,
				'message.from is required (no service default supplied)',
				'configuration-missing'
			)
		}
	}

	const toAddresses = Array.isArray(message.to) ? message.to : [message.to]
	if (toAddresses.length === 0) {
		return {
			ok: false as const,
			result: buildResult(false, undefined, 'No recipients supplied', 'invalid-recipient')
		}
	}
	if (!hasEmailBodyContent(message)) {
		return {
			ok: false as const,
			result: buildResult(false, undefined, EMAIL_BODY_REQUIRED_ERROR, 'configuration-missing')
		}
	}

	return { ok: true as const, from: message.from, toAddresses }
}

export function buildProviderMessagePayload<TAttachment>(
	message: EmailMessage,
	prepared: { from: string; toAddresses: string[] },
	buildAttachment: (attachment: NonNullable<EmailMessage['attachments']>[number]) => TAttachment
) {
	return {
		from: prepared.from,
		to: prepared.toAddresses,
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
	}
}
