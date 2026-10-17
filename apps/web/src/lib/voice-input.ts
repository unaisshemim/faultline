export interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
export type RecognitionConstructor = new () => Recognition
export function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return browser.SpeechRecognition || browser.webkitSpeechRecognition
}

// Recognition results are a cumulative list: rebuild the draft to avoid duplicating interim words.
export function startDictation(RecognitionAPI: RecognitionConstructor, initial: string, callbacks: {
  draft: (text: string) => void; listening: (active: boolean) => void; error: (message: string) => void
}) {
  const recognition = new RecognitionAPI()
  recognition.lang = 'en-IN'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.onresult = event => {
    const transcript = Array.from(event.results).map(result => result[0].transcript.trim()).filter(Boolean).join(' ')
    callbacks.draft([initial.trim(), transcript].filter(Boolean).join(' '))
  }
  recognition.onerror = event => {
    callbacks.listening(false)
    callbacks.error(event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Microphone access was denied. Allow microphone access in your browser, then try again.'
      : event.error === 'no-speech' ? 'No speech detected. Try the microphone again.'
      : 'Voice input stopped. Check your microphone and connection, or type your message.')
  }
  recognition.onend = () => callbacks.listening(false)
  try { recognition.start(); callbacks.listening(true) }
  catch { callbacks.error('Could not start the microphone. Try again or type your message.'); callbacks.listening(false) }
  return {
    stop: () => recognition.stop(),
    dispose: () => { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.abort() },
  }
}
