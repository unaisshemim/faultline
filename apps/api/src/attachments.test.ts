import { expect, it } from 'vitest'
import type { FileUIPart } from 'ai'
import { attachmentError, attachmentMaxBytes } from '../../../shared/attachments.js'

const file = (url = 'data:image/png;base64,YWJj', mediaType = 'image/png'): FileUIPart => ({ type: 'file', mediaType, filename: 'demo-meter.png', url })
it('accepts inline images and PDFs, including text-only messages', () => {
  expect(attachmentError([{ type: 'text', text: 'Summarize the installation.' }])).toBeNull()
  expect(attachmentError([file(), file('data:application/pdf;base64,YWJj', 'application/pdf')])).toBeNull()
})
it('rejects remote URLs, unsupported types, malformed data, and too many files', () => {
  expect(attachmentError([file('https://example.com/meter.png')])).toContain('inline')
  expect(attachmentError([file('data:text/html;base64,YWJj', 'text/html')])).toContain('PNG')
  expect(attachmentError([file('data:image/png;base64,!!!=')])).toContain('Invalid')
  expect(attachmentError([file(), file(), file(), file()])).toContain('3 files')
})
it('enforces the combined decoded size rather than each file independently', () => {
  const data = Buffer.alloc(Math.floor(attachmentMaxBytes / 2) + 1).toString('base64')
  expect(attachmentError([file(`data:image/png;base64,${data}`), file(`data:image/png;base64,${data}`)])).toContain('2 MB')
})
