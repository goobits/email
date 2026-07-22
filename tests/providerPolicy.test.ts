import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
	createProviderResultBuilder,
	prepareProviderMessage
} from '../src/_internal/providerPolicy.ts'
import type { EmailMessage } from '../src/types.ts'

const buildResult = createProviderResultBuilder('test-provider', 'fallback failure')

describe('email provider policy', () => {
	it('builds the shared success and failure envelopes', () => {
		expect(buildResult(true, 'message-1')).toEqual({
			success: true,
			messageId: 'message-1',
			provider: 'test-provider'
		})
		expect(buildResult(false)).toEqual({
			success: false,
			provider: 'test-provider',
			error: 'fallback failure',
			reason: 'transport-error'
		})
	})

	it('prepares valid messages and preserves runtime preflight failures', () => {
		expect(
			prepareProviderMessage(
				{ from: 'sender@example.test', to: 'user@example.test', subject: 'Hi', text: 'Body' },
				buildResult
			)
		).toEqual({
			ok: true,
			from: 'sender@example.test',
			toAddresses: ['user@example.test']
		})

		const missingFrom = prepareProviderMessage(
			{ to: 'user@example.test', subject: 'Hi', text: 'Body' },
			buildResult
		)
		expect(missingFrom).toMatchObject({
			ok: false,
			result: { success: false, reason: 'configuration-missing' }
		})

		const noRecipients = prepareProviderMessage(
			{ from: 'sender@example.test', to: [], subject: 'Hi', text: 'Body' },
			buildResult
		)
		expect(noRecipients).toMatchObject({
			ok: false,
			result: { success: false, reason: 'invalid-recipient' }
		})

		const noContent = prepareProviderMessage(
			{
				from: 'sender@example.test',
				to: 'user@example.test',
				subject: 'Hi'
			} as EmailMessage,
			buildResult
		)
		expect(noContent).toMatchObject({
			ok: false,
			result: { success: false, reason: 'configuration-missing' }
		})
	})

	it('keeps shared policy private and transport-specific mapping local', async () => {
		const [manifest, policy, ses, resend, smtp] = await Promise.all([
			readFile(new URL('../package.json', import.meta.url), 'utf8'),
			readFile(new URL('../src/_internal/providerPolicy.ts', import.meta.url), 'utf8'),
			readFile(new URL('../src/providers/ses.ts', import.meta.url), 'utf8'),
			readFile(new URL('../src/providers/resend.ts', import.meta.url), 'utf8'),
			readFile(new URL('../src/providers/smtp.ts', import.meta.url), 'utf8')
		])

		expect(manifest).not.toContain('_internal/providerPolicy')
		for (const source of [ses, resend, smtp]) {
			expect(source).toContain("from '../_internal/providerPolicy.ts'")
			expect(source).not.toContain('function buildResult(')
		}
		expect(policy.match(/message\.from is required/g)).toHaveLength(1)
		expect(policy.match(/No recipients supplied/g)).toHaveLength(1)
		expect(
			policy.match(/At least one of message\.html or message\.text is required/g)
		).toHaveLength(1)
	})
})
