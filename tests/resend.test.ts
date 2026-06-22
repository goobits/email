import { describe, expect, it, vi } from 'vitest'

import { createResendProvider } from '../src/providers/resend.ts'

// Resend SDK shape: `client.emails.send(payload)` → `{ data, error }`.
// Stub it with a function we can spy + control per test.
type ResendResponse = { data: { id: string } | null; error: { name?: string; message?: string } | null }

function createFakeResendClient(
	responder: (payload: unknown) => ResendResponse | Promise<ResendResponse>
) {
	const send = vi.fn(async (payload: unknown) => responder(payload))
	return {
		emails: { send }
	} as unknown as Parameters<typeof createResendProvider>[0]['client']
}

describe('createResendProvider', () => {
	it('returns success + messageId on Resend success', async () => {
		const client = createFakeResendClient(() => ({
			data: { id: 'msg-123' },
			error: null
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi'
		})
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.provider).toBe('resend')
			expect(result.messageId).toBe('msg-123')
		}
	})

	it('forwards subject, html, text, from, to', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			html: '<p>hi</p>',
			text: 'hi'
		})
		expect(captured.from).toBe('sender@example.com')
		expect(captured.to).toEqual([ 'user@example.com' ])
		expect(captured.subject).toBe('hi')
		expect(captured.html).toBe('<p>hi</p>')
		expect(captured.text).toBe('hi')
	})

	it('forwards cc, bcc, replyTo correctly', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			cc: [ 'cc1@example.com', 'cc2@example.com' ],
			bcc: [ 'bcc@example.com' ],
			replyTo: 'reply@example.com',
			subject: 'hi',
			text: 'hi'
		})
		expect(captured.cc).toEqual([ 'cc1@example.com', 'cc2@example.com' ])
		expect(captured.bcc).toEqual([ 'bcc@example.com' ])
		expect(captured.replyTo).toBe('reply@example.com')
	})

	it('forwards array recipients as-is', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'a@b.com',
			to: [ 'one@e.com', 'two@e.com' ],
			subject: 'x',
			text: 'x'
		})
		expect(captured.to).toEqual([ 'one@e.com', 'two@e.com' ])
	})

	it('forwards default tag when supplied', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client, tag: 'transactional' })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(captured.tags).toEqual([ { name: 'category', value: 'transactional' } ])
	})

	it('per-message x-resend-tag header overrides default tag', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client, tag: 'transactional' })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			headers: { 'x-resend-tag': 'marketing' }
		})
		expect(captured.tags).toEqual([ { name: 'category', value: 'marketing' } ])
	})

	it('maps attachments with Buffer content', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			attachments: [
				{ filename: 'doc.pdf', content: Buffer.from('PDF-bytes'), contentType: 'application/pdf' }
			]
		})
		expect(captured.attachments).toHaveLength(1)
		expect(captured.attachments[0].filename).toBe('doc.pdf')
		expect(captured.attachments[0].contentType).toBe('application/pdf')
		expect(Buffer.isBuffer(captured.attachments[0].content)).toBe(true)
	})

	it('maps attachments with Uint8Array content to Buffer', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			attachments: [
				{ filename: 'd.bin', content: new Uint8Array([ 1, 2, 3 ]) }
			]
		})
		expect(Buffer.isBuffer(captured.attachments[0].content)).toBe(true)
	})

	it('maps attachments with base64 string content as-is', async () => {
		let captured: any
		const client = createFakeResendClient((payload) => {
			captured = payload
			return { data: { id: 'x' }, error: null }
		})
		const provider = createResendProvider({ client })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			attachments: [
				{ filename: 'd.bin', content: 'SGVsbG8=' }
			]
		})
		expect(captured.attachments[0].content).toBe('SGVsbG8=')
	})

	it('returns configuration-missing when from is omitted', async () => {
		const provider = createResendProvider({ client: createFakeResendClient(() => ({ data: { id: 'x' }, error: null })) })
		const result = await provider.send({
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('returns invalid-recipient when to is an empty array', async () => {
		const provider = createResendProvider({ client: createFakeResendClient(() => ({ data: { id: 'x' }, error: null })) })
		const result = await provider.send({
			from: 'a@b.com',
			to: [],
			subject: 'x',
			text: 'x'
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
		}
	})

	it('returns configuration-missing when both html and text omitted', async () => {
		const provider = createResendProvider({ client: createFakeResendClient(() => ({ data: { id: 'x' }, error: null })) })
		const result = await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x'
		} as any)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('maps Resend rate_limit_exceeded → rate-limited', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'rate_limit_exceeded', message: 'Too many requests' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('rate-limited')
			expect(result.error).toContain('Too many requests')
		}
	})

	it('maps Resend invalid_from_address → invalid-recipient', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'invalid_from_address', message: 'bad address' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
		}
	})

	it('maps Resend validation_error → invalid-recipient', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'validation_error', message: 'bad input' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
		}
	})

	it('maps Resend invalid_api_key → configuration-missing', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'invalid_api_key', message: 'bad key' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('maps Resend missing_api_key → configuration-missing', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'missing_api_key', message: 'no key' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('unknown Resend errors map to transport-error', async () => {
		const client = createFakeResendClient(() => ({
			data: null,
			error: { name: 'something_else', message: 'Boom' }
		}))
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('transport-error')
			expect(result.error).toContain('Boom')
		}
	})

	it('thrown exceptions are caught + mapped to transport-error', async () => {
		const client = createFakeResendClient(() => {
			throw new Error('Network down')
		})
		const provider = createResendProvider({ client })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('transport-error')
			expect(result.error).toBe('Network down')
		}
	})

	it('verify() returns success when client present', async () => {
		const provider = createResendProvider({
			client: createFakeResendClient(() => ({ data: { id: 'x' }, error: null }))
		})
		const result = await provider.verify?.()
		expect(result?.success).toBe(true)
	})
})
