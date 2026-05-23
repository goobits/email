import { describe, expect, it } from 'vitest'

import { createMockProvider } from '../src/providers/mock.js'

describe('createMockProvider', () => {
	it('captures sent messages', async () => {
		const provider = createMockProvider()
		await provider.send({
			to: 'a@example.com',
			subject: 'one',
			text: 'first'
		})
		await provider.send({
			to: 'b@example.com',
			subject: 'two',
			text: 'second'
		})

		const sent = provider.getSentMessages()
		expect(sent).toHaveLength(2)
		expect(sent[0]?.to).toBe('a@example.com')
		expect(sent[1]?.to).toBe('b@example.com')
	})

	it('clear() empties the captured list', async () => {
		const provider = createMockProvider()
		await provider.send({ to: 'a@example.com', subject: 'x', text: 'x' })
		expect(provider.getSentMessages()).toHaveLength(1)
		provider.clear()
		expect(provider.getSentMessages()).toHaveLength(0)
	})

	it('returns synthetic messageId on success', async () => {
		const provider = createMockProvider()
		const result = await provider.send({ to: 'a@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.messageId).toMatch(/^mock-\d+$/)
			expect(result.provider).toBe('mock')
		}
	})

	it('failAllSends returns failure result', async () => {
		const provider = createMockProvider({ failAllSends: true, failureReason: 'invalid-recipient' })
		const result = await provider.send({ to: 'bad', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
		}
	})

	it('failAllSends still captures the message (useful for asserting was-attempted)', async () => {
		const provider = createMockProvider({ failAllSends: true })
		await provider.send({ to: 'a@e.com', subject: 'x', text: 'x' })
		expect(provider.getSentMessages()).toHaveLength(1)
	})

	it('verify returns success', async () => {
		const provider = createMockProvider()
		const result = await provider.verify?.()
		expect(result?.success).toBe(true)
	})
})
