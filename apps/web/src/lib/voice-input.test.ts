import { expect, it, vi } from 'vitest'
import { startDictation, type Recognition } from './voice-input'
class FakeRecognition implements Recognition {
  static current: FakeRecognition
  constructor() { FakeRecognition.current = this }
  lang = ''; continuous = false; interimResults = false
  onresult: Recognition['onresult'] = null
  onerror: Recognition['onerror'] = null
  onend: Recognition['onend'] = null
  start = vi.fn(); stop = vi.fn(); abort = vi.fn()
}
it('replaces interim words without duplication and preserves the typed draft', () => {
  const draft = vi.fn(), listening = vi.fn(), error = vi.fn()
  const session = startDictation(FakeRecognition, 'Please', { draft, listening, error })
  const mic = FakeRecognition.current
  mic.onresult!({ results: [{ isFinal: false, 0: { transcript: 'review bill' } }] })
  mic.onresult!({ results: [{ isFinal: true, 0: { transcript: 'review billing' } }, { isFinal: false, 0: { transcript: 'blockers' } }] })
  expect(draft.mock.calls).toEqual([['Please review bill'], ['Please review billing blockers']])
  session.stop(); expect(mic.stop).toHaveBeenCalledOnce()
  mic.onend!(); expect(listening).toHaveBeenLastCalledWith(false)
  session.dispose(); expect(mic.abort).toHaveBeenCalledOnce(); expect(mic.onresult).toBeNull()
})
it('reports denied microphone permission and clears listening state', () => {
  const callbacks = { draft: vi.fn(), listening: vi.fn(), error: vi.fn() }
  startDictation(FakeRecognition, '', callbacks)
  FakeRecognition.current.onerror!({ error: 'not-allowed' })
  expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining('denied'))
  expect(callbacks.listening).toHaveBeenLastCalledWith(false)
})
