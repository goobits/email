import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEmailService } from '../src/service.js'
import { createMockProvider } from '../src/providers/mock.js'
import type { EmailResult } from '../src/types.js'

describe('createEmailService', () => {
	afterEach(() => {
		vi.clearAllMocks()
	})

	it('applies default `from` when message omits it', async () => {
		const provider = createMockProvider()
		const service = createEmailService({
			provider,
			from: 'default@example.com'
		})
		await service.send({ to: 'user@example.com', subject: 'hi', text: 'hi' })
		expect(provider.getSentMessages()[0]?.from).toBe('default@example.com')
	})

	it('per-message `from` overrides default', async () => {
		const provider = createMockProvider()
		const service = createEmailService({
			provider,
			from: 'default@example.com'
		})
		await service.send({
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			from: 'override@example.com'
		})
		expect(provider.getSentMessages()[0]?.from).toBe('override@example.com')
	})

	it('applies default `replyTo` only when message omits it', async () => {
		const provider = createMockProvider()
		const service = createEmailService({
			provider,
			from: 'sender@example.com',
			replyTo: 'support@example.com'
		})
		await service.send({ to: 'user@example.com', subject: 'hi', text: 'hi' })
		expect(provider.getSentMessages()[0]?.replyTo).toBe('support@example.com')

		await service.send({
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			replyTo: 'other@example.com'
		})
		expect(provider.getSentMessages()[1]?.replyTo).toBe('other@example.com')
	})

	it('returns provider result on success', async () => {
		const provider = createMockProvider()
		const service = createEmailService({ provider, from: 'a@b.com' })
		const result = await service.send({ to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.provider).toBe('mock')
			expect(result.messageId).toMatch(/^mock-\d+$/)
		}
	})

	it('returns provider failure (does not throw)', async () => {
		const provider = createMockProvider({ failAllSends: true, failureReason: 'rate-limited' })
		const service = createEmailService({ provider, from: 'a@b.com' })
		const result = await service.send({ to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('rate-limited')
		}
	})

	it('disabled service bypasses provider', async () => {
		const provider = createMockProvider()
		const service = createEmailService({ provider, from: 'a@b.com', disabled: true })
		const result = await service.send({ to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.provider).toBe('disabled')
		}
		expect(provider.getSentMessages()).toHaveLength(0)
	})

	it('logger receives info on success, error on failure', async () => {
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		}
		const failing = createMockProvider({ failAllSends: true })
		const service = createEmailService({ provider: failing, from: 'a@b.com', logger })
		await service.send({ to: 'u@e.com', subject: 'x', text: 'x' })
		expect(logger.error).toHaveBeenCalledTimes(1)
		expect(logger.info).not.toHaveBeenCalled()

		logger.error.mockClear()
		const ok = createMockProvider()
		const service2 = createEmailService({ provider: ok, from: 'a@b.com', logger })
		await service2.send({ to: 'u@e.com', subject: 'x', text: 'x' })
		expect(logger.info).toHaveBeenCalledTimes(1)
		expect(logger.error).not.toHaveBeenCalled()
	})

	it('sendBatch fan-outs sequentially, one call per recipient', async () => {
		const provider = createMockProvider()
		const service = createEmailService({ provider, from: 'a@b.com' })
		const results = await service.sendBatch(
			[ 'one@example.com', 'two@example.com', 'three@example.com' ],
			{ subject: 'batch', text: 'hi' }
		)
		expect(results).toHaveLength(3)
		expect(provider.getSentMessages()).toHaveLength(3)
		expect(provider.getSentMessages().map(m => m.to)).toEqual([
			'one@example.com',
			'two@example.com',
			'three@example.com'
		])
	})

	it('sendBatch with empty recipients returns empty array (no provider call)', async () => {
		const provider = createMockProvider()
		const service = createEmailService({ provider, from: 'a@b.com' })
		const results: EmailResult[] = await service.sendBatch([], { subject: 'x', text: 'x' })
		expect(results).toEqual([])
		expect(provider.getSentMessages()).toHaveLength(0)
	})

	it('verify delegates to provider when defined', async () => {
		const provider = createMockProvider()
		const service = createEmailService({ provider, from: 'a@b.com' })
		const result = await service.verify()
		expect(result.success).toBe(true)
	})
})
