import { describe, expect, it, vi } from 'vitest'

import { createSmtpProvider } from '../src/providers/smtp.ts'

// nodemailer Transporter shape: { sendMail, verify }. Stub both.
type SendResult = { messageId?: string }

function createFakeTransporter(
	sendResponder: (options: unknown) => SendResult | Promise<SendResult>,
	verifyResponder: () => unknown | Promise<unknown> = () => true
) {
	const sendMail = vi.fn(async (options: unknown) => sendResponder(options))
	const verify = vi.fn(async () => verifyResponder())
	return {
		sendMail,
		verify
	} as unknown as Parameters<typeof createSmtpProvider>[0]['transporter']
}

describe('createSmtpProvider', () => {
	it('returns success + messageId on send', async () => {
		const transporter = createFakeTransporter(() => ({ messageId: '<abc@host>' }))
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi'
		})
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.provider).toBe('smtp')
			expect(result.messageId).toBe('<abc@host>')
		}
	})

	it('forwards from, to, subject, html, text', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			html: '<p>hi</p>',
			text: 'hi'
		})
		expect(captured.from).toBe('sender@example.com')
		expect(captured.to).toEqual(['user@example.com'])
		expect(captured.subject).toBe('hi')
		expect(captured.html).toBe('<p>hi</p>')
		expect(captured.text).toBe('hi')
	})

	it('forwards cc, bcc, replyTo', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			cc: ['cc@example.com'],
			bcc: ['bcc@example.com'],
			replyTo: 'reply@example.com',
			subject: 'x',
			text: 'x'
		})
		expect(captured.cc).toEqual(['cc@example.com'])
		expect(captured.bcc).toEqual(['bcc@example.com'])
		expect(captured.replyTo).toBe('reply@example.com')
	})

	it('forwards custom headers', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			headers: { 'X-Campaign-ID': 'spring-2026' }
		})
		expect(captured.headers).toEqual({ 'X-Campaign-ID': 'spring-2026' })
	})

	it('maps attachments with Buffer content as-is', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
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
		expect(captured.attachments[0].content.toString()).toBe('PDF-bytes')
	})

	it('decodes base64 string content to Buffer (preserving byte fidelity)', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x',
			attachments: [{ filename: 'd.bin', content: Buffer.from('Hello').toString('base64') }]
		})
		expect(Buffer.isBuffer(captured.attachments[0].content)).toBe(true)
		expect(captured.attachments[0].content.toString()).toBe('Hello')
	})

	it('inline attachments set cid + contentDisposition', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			html: '<img src="cid:logo">',
			attachments: [
				{ filename: 'logo.png', cid: 'logo', inline: true, content: new Uint8Array([1, 2, 3]) }
			]
		})
		expect(captured.attachments[0].cid).toBe('logo')
		expect(captured.attachments[0].contentDisposition).toBe('inline')
	})

	it('inline attachment without explicit cid defaults to filename', async () => {
		let captured: any
		const transporter = createFakeTransporter((opts) => {
			captured = opts
			return { messageId: 'x' }
		})
		const provider = createSmtpProvider({ transporter })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			html: '<img src="cid:logo.png">',
			attachments: [{ filename: 'logo.png', inline: true, content: new Uint8Array([1]) }]
		})
		expect(captured.attachments[0].cid).toBe('logo.png')
	})

	it('returns configuration-missing when from is omitted', async () => {
		const transporter = createFakeTransporter(() => ({ messageId: 'x' }))
		const provider = createSmtpProvider({ transporter })
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
		const transporter = createFakeTransporter(() => ({ messageId: 'x' }))
		const provider = createSmtpProvider({ transporter })
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

	it('returns configuration-missing when html and text both omitted', async () => {
		const transporter = createFakeTransporter(() => ({ messageId: 'x' }))
		const provider = createSmtpProvider({ transporter })
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

	it('maps EAUTH error code → configuration-missing', async () => {
		const transporter = createFakeTransporter(() => {
			const err: any = new Error('Authentication failed')
			err.code = 'EAUTH'
			throw err
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('maps ECONFIG error code → configuration-missing (nodemailer v7+ rename of ECONFIGURATION)', async () => {
		const transporter = createFakeTransporter(() => {
			const err: any = new Error('Invalid configuration')
			err.code = 'ECONFIG'
			throw err
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('maps legacy ECONFIGURATION error code → configuration-missing (back-compat)', async () => {
		const transporter = createFakeTransporter(() => {
			const err: any = new Error('Invalid configuration')
			err.code = 'ECONFIGURATION'
			throw err
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
		}
	})

	it('maps SMTP 550 → invalid-recipient', async () => {
		const transporter = createFakeTransporter(() => {
			const err: any = new Error('Recipient not found')
			err.responseCode = 550
			throw err
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
		}
	})

	it('maps SMTP 421 → rate-limited', async () => {
		const transporter = createFakeTransporter(() => {
			const err: any = new Error('Service not available')
			err.responseCode = 421
			throw err
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('rate-limited')
		}
	})

	it('unknown errors → transport-error', async () => {
		const transporter = createFakeTransporter(() => {
			throw new Error('Network down')
		})
		const provider = createSmtpProvider({ transporter })
		const result = await provider.send({ from: 'a@b.com', to: 'u@e.com', subject: 'x', text: 'x' })
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('transport-error')
			expect(result.error).toBe('Network down')
		}
	})

	it('verify() returns success when transporter verifies', async () => {
		const transporter = createFakeTransporter(
			() => ({ messageId: 'x' }),
			() => true
		)
		const provider = createSmtpProvider({ transporter })
		const result = await provider.verify?.()
		expect(result?.success).toBe(true)
	})

	it('verify() returns failure when transporter throws', async () => {
		const transporter = createFakeTransporter(
			() => ({ messageId: 'x' }),
			() => {
				throw new Error('Connection refused')
			}
		)
		const provider = createSmtpProvider({ transporter })
		const result = await provider.verify?.()
		expect(result?.success).toBe(false)
		expect(result?.error).toBe('Connection refused')
	})
})
