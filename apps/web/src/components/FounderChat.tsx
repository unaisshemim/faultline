import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type FileUIPart, type UIMessage, type ToolUIPart } from 'ai'
import { ArrowUp, Sparkles, Check, Loader2, ArrowUpRight, RotateCcw, Square, Paperclip, X, Mic, MicOff, Volume2, VolumeX, SendHorizontal, Smile, Type } from 'lucide-react'
import type { Task, SystemStatus } from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Confirmation, ConfirmationTitle, ConfirmationRequest, ConfirmationAccepted, ConfirmationRejected, ConfirmationActions, ConfirmationAction } from '@/components/ai-elements/confirmation'
import { Attachments, Attachment, AttachmentPreview, AttachmentInfo, AttachmentRemove } from '@/components/ai-elements/attachments'
import { attachmentAccept, attachmentError, attachmentMaxBytes, attachmentMaxCount, attachmentTypes } from '../../../../shared/attachments'
import { recognitionConstructor, startDictation } from '@/lib/voice-input'
import { request } from '@/lib/api'
import { StatusBadge, dueLabel } from './WorkUI'

const examples = [
  { label: 'Plan an installation', text: 'Prepare the Itron installation readiness report by Friday. Include meter delivery, gateway availability, and installer access; estimate 4 hours.' },
  { label: 'Review billing blockers', text: 'What is blocking Itron water-billing reconciliation?' },
  { label: 'Find a technology owner', text: 'Who has capacity for a 4-hour Itron gateway telemetry investigation?' },
  { label: 'Plan R&D testing', text: 'Who can run a 4-hour Itron meter calibration bench test in R&D?' },
  { label: 'Coordinate support', text: 'Prepare an Itron resident onboarding guide by Friday; include app access and support contacts, estimated 3 hours.' },
]
type DraftFile = FileUIPart & { id: string }

interface Props { live?: boolean; onBusyChange?: (busy: boolean) => void; chatId: string; onNewChat: () => void; system: SystemStatus; onChanged: () => void; onTask: (id: string) => void; onSettings: () => void; starter: string; onStarterUsed: () => void }
function ChatText({ text, onTask }: { text: string; onTask: (id: string) => void }) {
  return <>{text.split(/(\[[^\]]+\]\(task:[^)]+\))/g).map((part, i) => {
    const match = part.match(/^\[([^\]]+)\]\(task:([^)]+)\)$/)
    return match ? <Button variant="ghost" key={i} className="plain-control inline-task-link" onClick={() => onTask(match[2])}>{match[1]}</Button> : <span key={i}>{part}</span>
  })}</>
}
export function FounderChat({ live = false, onBusyChange, chatId, onNewChat, system, onChanged, onTask, onSettings, starter, onStarterUsed }: Props) {
  const [listening, setListening] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [expandedComposer, setExpandedComposer] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const readAloudRef = useRef(false)
  const dictation = useRef<ReturnType<typeof startDictation> | null>(null)
  useEffect(() => () => { dictation.current?.dispose(); if (live) window.speechSynthesis?.cancel() }, [live])
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState('')
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<DraftFile[]>([])
  const [fileError, setFileError] = useState('')
  const [readingFiles, setReadingFiles] = useState(false)
  const [exampleIndex, setExampleIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages: messages.slice(-1) } }) }), [])
  const { messages, setMessages, sendMessage, status, error, stop, clearError } = useChat({ id: chatId, transport, onFinish: ({ message }) => { onChanged(); if (live && readAloudRef.current && window.speechSynthesis) { const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join(' '); if (text) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)) } } } })
  const busy = status === 'submitted' || status === 'streaming'
  const pendingApproval = messages.some(message => message.parts.some(part => part.type === 'tool-createTask' && 'state' in part && part.state === 'approval-requested'))
  useEffect(() => { onBusyChange?.(busy || listening || pendingApproval || approvalBusy !== null); return () => onBusyChange?.(false) }, [busy, listening, pendingApproval, approvalBusy, onBusyChange])
  const approve = async (id: string, approved: boolean) => {
    if (approvalBusy || busy) return
    setApprovalBusy(id); setApprovalError('')
    try {
      const history = await request<UIMessage[]>(`/chat/${encodeURIComponent(chatId)}/approval`, { method: 'POST', body: JSON.stringify({ approvalId: id, approved }) })
      setMessages(history); onChanged()
    } catch (error) { setApprovalError(error instanceof Error ? error.message : 'Could not save your decision. Try again.') } finally { setApprovalBusy(null) }
  }
  useEffect(() => {
    if (!system.database || loaded) return
    let cancelled = false
    request<UIMessage[]>(`/chat/${encodeURIComponent(chatId)}`).then(history => { if (!cancelled) { setMessages(history); setLoaded(true) } }).catch(() => { if (!cancelled && live) setVoiceError('Could not load this conversation. Refresh the page to try again.') })
    return () => { cancelled = true }
  }, [system.database, loaded, setMessages, chatId, live])
  useEffect(() => { if (starter) { setInput(starter); inputRef.current?.focus(); onStarterUsed() } }, [starter, onStarterUsed])
  useEffect(() => { transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return
    const timer = setInterval(() => setExampleIndex(index => (index + 1) % examples.length), 4500)
    return () => clearInterval(timer)
  }, [])
  const addFiles = async (selected: FileList | null) => {
    if (!selected) return
    const incoming = Array.from(selected)
    if (files.length + incoming.length > attachmentMaxCount) { setFileError('Attach up to 3 files.'); return }
    if (incoming.some(file => !attachmentTypes.includes(file.type) || file.size > attachmentMaxBytes)) { setFileError('Use images or PDFs, totaling 2 MB or less.'); return }
    setReadingFiles(true); setFileError('')
    try {
      const additions = await Promise.all(incoming.map(file => new Promise<DraftFile>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ id: crypto.randomUUID(), type: 'file', filename: file.name, mediaType: file.type, url: String(reader.result) })
        reader.onerror = () => reject(new Error('Could not read the attachment.'))
        reader.readAsDataURL(file)
      })))
      const next = [...files, ...additions]
      const validation = attachmentError(next)
      if (validation) setFileError(validation); else setFiles(next)
    } catch { setFileError('Could not read the attachment. Try again.') } finally { setReadingFiles(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }
  const toggleMicrophone = () => {
    if (listening) { dictation.current?.stop(); return }
    const API = recognitionConstructor()
    if (!API) { setVoiceError('Voice input is unavailable in this browser. Open this page in Chrome, or type your message.'); return }
    window.speechSynthesis?.cancel(); dictation.current?.dispose(); setVoiceError('')
    dictation.current = startDictation(API, input, { draft: setInput, listening: setListening, error: setVoiceError })
  }
  const submit = () => {
    if ((live && system.database && !loaded) || listening || !input.trim() || busy || readingFiles || pendingApproval || approvalBusy) return
    if (!system.openai || !system.database) { onSettings(); return }
    window.speechSynthesis?.cancel(); clearError(); setFileError(''); void sendMessage({ text: input.trim(), files: files.map(({ id: _id, ...file }) => file) }); setInput(''); setFiles([])
  }
  const retry = async () => {
    clearError()
    try {
      const history = await request<UIMessage[]>(`/chat/${encodeURIComponent(chatId)}`)
      setMessages(history)
      const last = history.at(-1)
      if (last?.role === 'user') void sendMessage(last)
      onChanged()
    } catch { onSettings() }
  }
  return <section className={`founder-chat ${messages.length ? 'has-conversation' : 'empty-conversation'}`} aria-label="Itron AI conversation">
    {!messages.length && !live && <div className="chat-welcome"><span className="chat-welcome-icon"><Sparkles size={24} strokeWidth={1.5} /></span><h1>{live ? 'Let’s talk about your work.' : 'What’s next for Itron?'}</h1>{live && <p>Ask a question, plan a task, or give a progress update.<br />Type below or use the microphone to get started.</p>}</div>}
    {messages.length > 0 && !live && <div className="conversation-toolbar"><span>Conversation</span><Button variant="ghost" size="sm" onClick={onNewChat} disabled={busy || listening || pendingApproval || approvalBusy !== null}>New chat</Button></div>}
    {messages.length > 0 && <div className="chat-transcript" ref={transcriptRef} aria-live="polite">
      {messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}>
        <span className="chat-speaker">{message.role === 'user' ? 'You' : <><Sparkles size={12} /> Company Brain</>}</span>
        {message.parts.map((part, index) => {
          if (part.type === 'file') return <Attachments variant="inline" key={index}><Attachment data={{ ...part, id: `${message.id}-${index}` }}><AttachmentPreview /><AttachmentInfo /></Attachment></Attachments>
          if (part.type === 'text') return <p className="chat-copy" key={index}><ChatText text={part.text} onTask={onTask} /></p>
          if (part.type === 'tool-createTask' && 'state' in part) {
            const toolPart = part as ToolUIPart
            const draft = toolPart.input as Partial<Task> | undefined
            const task = toolPart.state === 'output-available' ? (toolPart.output as { task?: Task })?.task : undefined
            return <div className="task-approval" key={index}>
              {toolPart.approval && <Confirmation approval={toolPart.approval} state={toolPart.state}>
                <ConfirmationTitle>
                  <ConfirmationRequest><strong>Create this task?</strong><div className="approval-task-details"><h3>{draft?.title}</h3><p>{draft?.description}</p><span>{draft?.requiredResponsibility} · {draft?.effortHours}h estimated</span><span>Due {draft?.dueAt && new Date(draft.dueAt).toLocaleString('en', { timeZone: system.timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ({system.timezone})</span><small>A qualified owner will be selected using current capacity when you approve.</small></div></ConfirmationRequest>
                  <ConfirmationAccepted><Check size={15} /><span>Task approved and saved.</span></ConfirmationAccepted>
                  <ConfirmationRejected><X size={15} /><span>Task rejected. Nothing was created.</span></ConfirmationRejected>
                </ConfirmationTitle>
                <ConfirmationActions>
                  <ConfirmationAction variant="outline" disabled={busy || approvalBusy !== null} onClick={() => void approve(toolPart.approval!.id, false)}>Reject</ConfirmationAction>
                  <ConfirmationAction disabled={busy || approvalBusy !== null} onClick={() => void approve(toolPart.approval!.id, true)}>{approvalBusy === toolPart.approval.id && <Loader2 size={14} className="animate-spin" />} Approve task</ConfirmationAction>
                </ConfirmationActions>
              </Confirmation>}
              {task && <Button variant="ghost" className="plain-control chat-task-card" onClick={() => onTask(task.id)}><span className="saved-task-icon"><Check size={17} /></span><span><strong>{task.title}</strong><span>Saved · Due {dueLabel(task.dueAt, system.timezone)}</span></span><StatusBadge status={task.status} /><ArrowUpRight size={16} /></Button>}
            </div>
          }
          return null
        })}
      </div>)}
      {busy && <div className="thinking"><Loader2 size={13} className="animate-spin" /> Looking into it…</div>}
    </div>}
    <div className={`composer ${busy ? 'working' : ''} ${expandedComposer ? 'composer-expanded' : ''}`}>
      {files.length > 0 && <Attachments variant="inline" className="draft-attachments">{files.map(file => <Attachment key={file.id} data={file} onRemove={() => setFiles(current => current.filter(item => item.id !== file.id))}><AttachmentPreview /><AttachmentInfo /><AttachmentRemove className="opacity-100" disabled={busy || readingFiles || pendingApproval || approvalBusy !== null} label={`Remove ${file.filename}`} /></Attachment>)}</Attachments>}
      <Textarea rows={1} ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} placeholder={listening ? 'Listening… speak naturally' : live ? 'Type a message' : 'What does Itron need to get done today?'} aria-label="Message Company Brain" className="composer-input" disabled={busy || listening || pendingApproval || approvalBusy !== null} />
      <div className="composer-bottom"><div className="composer-file-tools">{live && <><Button variant="ghost" size="icon" aria-label="Expand message composer" aria-pressed={expandedComposer} onClick={() => { setExpandedComposer(value => !value); inputRef.current?.focus() }}><Type size={20} /></Button><Button variant="ghost" size="icon" aria-label="Insert smile emoji" disabled={busy || listening || pendingApproval || approvalBusy !== null} onClick={() => { setInput(value => value + ' 🙂'); inputRef.current?.focus() }}><Smile size={21} /></Button></>}<input ref={fileInputRef} type="file" accept={attachmentAccept} multiple hidden aria-label="Upload images or PDFs" onChange={event => void addFiles(event.target.files)} /><Button variant="ghost" size="icon" aria-label="Attach images or PDFs" disabled={busy || readingFiles || pendingApproval || approvalBusy !== null} onClick={() => fileInputRef.current?.click()}>{readingFiles ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}</Button><span className="composer-caption">Images & PDFs · 2 MB total</span></div><div className="composer-actions">{live && <><Button variant="ghost" size="icon" aria-label={readAloud ? 'Turn off spoken replies' : 'Read replies aloud'} aria-pressed={readAloud} disabled={!('speechSynthesis' in window)} onClick={() => { const next = !readAloud; setReadAloud(next); readAloudRef.current = next; if (!next) window.speechSynthesis?.cancel() }}>{readAloud ? <Volume2 size={18} /> : <VolumeX size={18} />}</Button><Button variant="ghost" size="icon" className={listening ? 'mic-listening' : ''} aria-label={listening ? 'Stop listening' : 'Start voice input'} aria-pressed={listening} disabled={busy || pendingApproval || approvalBusy !== null} onClick={toggleMicrophone}>{listening ? <MicOff size={18} /> : <Mic size={18} />}</Button></>}{busy ? <Button size="icon" variant="ghost" aria-label="Stop response" onClick={() => stop()}><Square size={15} /></Button> : <><span className="enter-hint">↵ to send</span><Button size="icon" className="send-button" aria-label="Send message" disabled={listening || !input.trim() || readingFiles || pendingApproval || approvalBusy !== null} onClick={submit}>{live ? <SendHorizontal size={23} /> : <ArrowUp size={20} />}</Button></>}</div></div>
    </div>
    {live && listening && <div className="voice-status" role="status">{listening ? <><span className="listening-dot" /> Listening · tap the microphone to finish, then send</> : 'Voice input transcribes into your draft. Review it before sending.'}</div>}
    {voiceError && <p className="inline-error" role="alert">{voiceError}</p>}
    {error && <div className="chat-error" role="alert"><span>{error.message.startsWith('{') ? 'Could not reach OpenAI. Check your connection and try again.' : error.message}</span><Button variant="ghost" size="sm" onClick={() => void retry()}><RotateCcw size={13} /> Retry</Button></div>}
    {approvalError && <p className="inline-error" role="alert">{approvalError}</p>}
    {fileError && <p className="inline-error" role="alert">{fileError}</p>}
    {!messages.length && !live && <div className="rotating-examples" aria-label="Example prompts"><span>Try asking</span><Button variant="ghost" className="example-prompt" key={exampleIndex} onClick={() => { setInput(examples[exampleIndex].text); inputRef.current?.focus() }}>{examples[exampleIndex].label} <ArrowUpRight size={13} /></Button><div className="example-dots">{examples.map((example, index) => <Button variant="ghost" size="icon" key={example.label} aria-label={example.label} aria-pressed={exampleIndex === index} onClick={() => { setExampleIndex(index); setInput(example.text); inputRef.current?.focus() }}><span /></Button>)}</div></div>}
    {!system.openai && <Button variant="ghost" className="plain-control connect-notice" onClick={onSettings}><span className="connection-dot" /> Connect OpenAI to start your conversation <ArrowUpRight size={12} /></Button>}
  </section>
}
