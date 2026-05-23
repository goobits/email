import { describe, expect, it, vi } from 'vitest'

import { createSesProvider } from '../src/providers/ses.ts'

function createFakeSesClient(responder: (command: unknown) => unknown | Promise<unknown>) {
	return {
		send: vi.fn(async (command: unknown) => responder(command))
	} as unknown as Parameters<typeof createSesProvider>[0]['client']
}

describe('createSesProvider', () => {
	it('uses SendEmailCommand with simple text/html content', async () => {
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
		expect(captured.input.FromEmailAddress).toBe('sender@example.com')
		expect(captured.input.Destination.ToAddresses).toEqual([ 'user@example.com' ])
		expect(captured.input.Content.Simple.Subject.Data).toBe('hi')
		expect(captured.input.Content.Simple.Body.Html.Data).toBe('<p>hi</p>')
		expect(captured.input.Content.Simple.Body.Text.Data).toBe('hi')
	})

	it('forwards cc, bcc, replyTo, and configurationSetName', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client, configurationSetName: 'tx-emails' })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			cc: [ 'cc@example.com' ],
			bcc: [ 'bcc@example.com' ],
			replyTo: 'reply@example.com',
			subject: 'hi',
			text: 'hi'
		})

		expect(captured.input.Destination.CcAddresses).toEqual([ 'cc@example.com' ])
		expect(captured.input.Destination.BccAddresses).toEqual([ 'bcc@example.com' ])
		expect(captured.input.ReplyToAddresses).toEqual([ 'reply@example.com' ])
		expect(captured.input.ConfigurationSetName).toBe('tx-emails')
	})

	it('maps attachments to SES Simple.Attachments', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			attachments: [
				{ filename: 'doc.pdf', content: new Uint8Array([ 1, 2, 3 ]), contentType: 'application/pdf' }
			]
		})

		expect(captured.input.Content.Simple.Attachments).toEqual([
			{
				FileName: 'doc.pdf',
				RawContent: new Uint8Array([ 1, 2, 3 ]),
				ContentType: 'application/pdf',
				ContentDisposition: 'ATTACHMENT',
				ContentTransferEncoding: 'BASE64'
			}
		])
	})

	it('maps inline attachments with ContentId and decodes base64 string content', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			html: '<img src="cid:logo">',
			attachments: [
				{ filename: 'logo.png', cid: 'logo', inline: true, content: 'AQID', contentType: 'image/png' }
			]
		})

		expect(captured.input.Content.Simple.Attachments[0]).toMatchObject({
			FileName: 'logo.png',
			ContentType: 'image/png',
			ContentDisposition: 'INLINE',
			ContentId: 'logo',
			ContentTransferEncoding: 'BASE64'
		})
		expect(captured.input.Content.Simple.Attachments[0].RawContent).toEqual(new Uint8Array([ 1, 2, 3 ]))
	})

	it('maps custom headers to SES message headers', async () => {
		let captured: any
		const client = createFakeSesClient(command => {
			captured = command
			return { MessageId: 'x' }
		})
		const provider = createSesProvider({ client })
		await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			headers: { 'X-Campaign-ID': 'spring-2026' }
		})

		expect(captured.input.Content.Simple.Headers).toEqual([
			{ Name: 'X-Campaign-ID', Value: 'spring-2026' }
		])
	})

	it('rejects invalid custom headers before calling SES v2', async () => {
		const client = createFakeSesClient(() => ({ MessageId: 'x' }))
		const provider = createSesProvider({ client })
		const result = await provider.send({
			from: 'sender@example.com',
			to: 'user@example.com',
			subject: 'hi',
			text: 'hi',
			headers: { 'X-Bad': 'ok\r\nX-Injected: yes' }
		})

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.reason).toBe('configuration-missing')
			expect(result.error).toContain('printable ASCII')
		}
		expect((client as any).send).not.toHaveBeenCalled()
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

	it('maps SES throttling errors to rate-limited reason', async () => {
		const client = createFakeSesClient(() => {
			const err = new Error('Too many requests')
			err.name = 'TooManyRequestsException'
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

	it('maps SES rejected messages to invalid-recipient reason', async () => {
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

	it('verify() returns success when client present', async () => {
		const provider = createSesProvider({ client: createFakeSesClient(() => ({})) })
		const result = await provider.verify?.()
		expect(result?.success).toBe(true)
	})
})
