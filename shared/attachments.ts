import type { FileUIPart, UIMessage } from 'ai'

export const attachmentTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
export const attachmentAccept = '.png,.jpg,.jpeg,.webp,.pdf'
export const attachmentMaxBytes = 2 * 1024 * 1024
export const attachmentMaxCount = 3

// Only inline uploaded files reach the model; remote URLs cannot trigger fetching.
export function attachmentError(parts: UIMessage['parts']): string | null {
  if (parts.some(part => part.type !== 'text' && part.type !== 'file')) return 'Send text with optional images or PDFs.'
  const files = parts.filter((part): part is FileUIPart => part.type === 'file')
  if (files.length > attachmentMaxCount) return 'Attach up to 3 files.'
  let bytes = 0
  for (const file of files) {
    if (!attachmentTypes.includes(file.mediaType) || (file.filename && (typeof file.filename !== 'string' || file.filename.length > 200))) return 'Use PNG, JPEG, WebP, or PDF attachments.'
    if (typeof file.url !== 'string') return 'Invalid attachment.'
    const prefix = `data:${file.mediaType};base64,`
    if (!file.url.startsWith(prefix)) return 'Attachments must be uploaded inline.'
    const encoded = file.url.slice(prefix.length)
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return 'Invalid attachment data.'
    bytes += encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
  }
  return bytes > attachmentMaxBytes ? 'Attachments must total 2 MB or less.' : null
}
