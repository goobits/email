/**
 * In-memory `EmailProvider` for tests. Captures every sent message in an
 * array; `getSentMessages()` and `clear()` let tests assert + reset.
 *
 * @module @goobits/email/mock
 */

import type { EmailMessage, EmailProvider, EmailResult } from '../types.js'

export interface MockProviderOptions {
	/**
	 * If true, every `send()` resolves with `success: false`. Useful for
	 * testing error-path code paths. Default: false.
	 */
	failAllSends?: boolean
	/** Reason returned in the failed result. Default: `'transport-error'`. */
	failureReason?: 'invalid-recipient' | 'transport-error' | 'rate-limited' | 'unknown'
}

export interface MockProvider extends EmailProvider {
	getSentMessages(): readonly EmailMessage[]
	clear(): void
}

let messageCounter = 0

/**
 * Build a mock provider. Each successful send increments an internal
 * counter and returns a synthetic `messageId` like `'mock-1'`.
 */
export function createMockProvider(options: MockProviderOptions = {}): MockProvider {
	const sent: EmailMessage[] = []
	const failAllSends = options.failAllSends === true
	const failureReason = options.failureReason ?? 'transport-error'

	async function send(message: EmailMessage): Promise<EmailResult> {
		sent.push(message)
		if (failAllSends) {
			return {
				success: false,
				provider: 'mock',
				error: 'Mock provider configured to fail',
				reason: failureReason
			}
		}
		messageCounter++
		return {
			success: true,
			provider: 'mock',
			messageId: `mock-${ messageCounter }`
		}
	}

	async function verify(): Promise<{ success: boolean; error?: string }> {
		return { success: true }
	}

	return {
		name: 'mock',
		send,
		verify,
		getSentMessages: () => sent,
		clear: () => {
			sent.length = 0
		}
	}
}
