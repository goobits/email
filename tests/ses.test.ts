import { describe, expect, it, vi } from 'vitest'

import { createSesProvider } from '../src/providers/ses.js'

// We don't depend on actual SES — stub the SDK calls via a fake client.
// The `client.send()` method is the integration point; mock it to assert
// command shape + simulate success/failure paths.
function createFakeSesClient(responder: (command: unknown) => unknown | Promise<unknown>) {
	return {
		send: vi.fn(async (command: unknown) => responder(command))
	} as unknown as Parameters<typeof createSesProvider>[0]['client']
}

describe('createSesProvider', () => {
	it('uses SendEmailCommand for attachment-free messages', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'ses-abc-123' }
		})
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			html: '<p>hi</p>',
			text: 'hi'
		})

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.provider).toBe('aws-ses')
			expect(result.messageId).toBe('ses-abc-123')
		}
		expect(captured.constructor.name).toBe('SendEmailCommand')
		expect(captured.input.Source).toBe('sender@example.com')
		expect(captured.input.Destination.ToAddresses).toEqual([ 'user@example.com' ])
		expect(captured.input.Message.Subject.Data).toBe('hi')
		expect(captured.input.Message.Body.Html.Data).toBe('<p>hi</p>')
		expect(captured.input.Message.Body.Text.Data).toBe('hi')
	})

	it('forwards cc, bcc, replyTo correctly', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			cc: [ 'cc1@example.com', 'cc2@example.com' ],
			bcc: [ 'bcc@example.com' ],
			replyTo: 'reply@example.com',
			subject: 'hi',
			text: 'hi'
		})
		expect(captured.input.Destination.CcAddresses).toEqual([ 'cc1@example.com', 'cc2@example.com' ])
		expect(captured.input.Destination.BccAddresses).toEqual([ 'bcc@example.com' ])
		expect(captured.input.ReplyToAddresses).toEqual([ 'reply@example.com' ])
	})

	it('forwards configurationSetName when supplied', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client, configurationSetName: 'tx-emails' })
		await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(captured.input.ConfigurationSetName).toBe('tx-emails')
	})

	it('uses SendRawEmailCommand when attachments present', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'raw-id' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			attachments: [
				{ filename: 'doc.pdf', content: Buffer.from('PDF-bytes'), contentType: 'application/pdf' }
			]
		})
		expect(captured.constructor.name).toBe('SendRawEmailCommand')
		const raw = new TextDecoder().decode(captured.input.RawMessage.Data)
		expect(raw).toContain('From: sender@example.com')
		expect(raw).toContain('Subject: hi')
		expect(raw).toContain('Content-Type: application/pdf; name="doc.pdf"')
	})

	it('uses SendRawEmailCommand when custom headers present', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'raw-id' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			headers: { 'X-Campaign-ID': 'spring-2026' }
		})
		expect(captured.constructor.name).toBe('SendRawEmailCommand')
		const raw = new TextDecoder().decode(captured.input.RawMessage.Data)
		expect(raw).toContain('X-Campaign-ID: spring-2026')
	})

	it('rejects CR/LF header injection in raw MIME fields', async () => {
		const client = createFakeSesClient(() => ({ MessageId: 'x' }))
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi\r\nX-Injected: yes',
			text: 'hi',
			headers: { 'X-Campaign-ID': 'spring-2026' }
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
			expect(result.error).toContain('CR or LF')
		}
		expect((client as any).send).not.toHaveBeenCalled()
	})

	it('adds Content-ID for inline attachments', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'raw-id' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			html: '<img src="cid:logo">',
			attachments: [
				{ filename: 'logo.png', cid: 'logo', inline: true, content: new Uint8Array([ 1, 2, 3 ]), contentType: 'image/png' }
			]
		})
		const raw = new TextDecoder().decode(captured.input.RawMessage.Data)
		expect(raw).toContain('Content-Disposition: inline; filename="logo.png"')
		expect(raw).toContain('Content-ID: <logo>')
	})

	it('returns configuration-missing when from is omitted', async () => {
		const provider = createSesProvider({ client: createFakeSesClient(() => ({ MessageId: 'x' })) })
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
		const provider = createSesProvider({ client: createFakeSesClient(() => ({ MessageId: 'x' })) })
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

	it('returns configuration-missing when html and text are omitted', async () => {
		const provider = createSesProvider({ client: createFakeSesClient(() => ({ MessageId: 'x' })) })
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

	it('maps SES Throttling errors to rate-limited reason', async () => {
		const client = createFakeSesClient(() => {
			const err = new Error('Rate exceeded')
			err.name = 'Throttling'
			throw err
		})
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('rate-limited')
		}
	})

	it('maps SES MessageRejected errors to invalid-recipient reason', async () => {
		const client = createFakeSesClient(() => {
			const err = new Error('Email address not verified')
			err.name = 'MessageRejected'
			throw err
		})
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('invalid-recipient')
			expect(result.error).toContain('not verified')
		}
	})

	it('unknown errors map to transport-error', async () => {
		const client = createFakeSesClient(() => {
			throw new Error('Boom')
		})
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'a@b.com',
			to: 'u@e.com',
			subject: 'x',
			text: 'x'
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('transport-error')
			expect(result.error).toBe('Boom')
		}
	})

	it('verify() returns success when client present', async () => {
		const provider = createSesProvider({ client: createFakeSesClient(() => ({})) })
		const result = await provider.verify?.()
		expect(result?.success).toBe(true)
	})
})
