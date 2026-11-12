import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { askAssistant, getAssistantExamples, isAbortError, toApiError } from '../api'
import { useApi } from '../hooks/useApi'
import type { AssistantResponse, IntentId, SourceLink } from '../types'
import { AssistantOrb, type OrbState } from './AssistantOrb'
import { CloseIcon, SendIcon, TrashIcon } from './icons'
import { Badge } from './ui'
import { downloadStatementAs, type StatementFormat } from '../utils/statementDocs'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  response?: AssistantResponse
  isError?: boolean
}

const FALLBACK_EXAMPLES = [
  'Bu ay neden satışlar düştü?',
  'Hangi müşterileri kaybediyoruz?',
  'Hangi ürün zarar ettiriyor?',
  'Öncelikle ne yapmalıyım?',
]

/** Cevabın dayandığı analizin ayrıntılı sayfası. */
const INTENT_PAGES: Partial<Record<IntentId, { to: string; label: string }>> = {
  sales_change: { to: '/sales', label: 'Satış Analizi' },
  top_sellers: { to: '/sales', label: 'Satış Analizi' },
  margin: { to: '/sales', label: 'Marj analizi' },
  churn: { to: '/customers', label: 'Müşteri Analizi' },
  risks: { to: '/risks', label: 'Risk Tespiti' },
  inventory: { to: '/inventory', label: 'Stok Analizi' },
  opportunities: { to: '/inventory', label: 'Stok transfer fırsatları' },
  recommendations: { to: '/recommendations', label: 'Öneriler' },
  summary: { to: '/', label: 'Genel Bakış' },
  profit: { to: '/', label: 'Genel Bakış' },
  market: { to: '/', label: 'Gündem' },
  segments: { to: '/segments', label: 'Departman & Proje' },
  receivables: { to: '/receivables', label: 'Cari & Alacak' },
}

/** Gündem soruları (backend'deki "market" niyetinin kaba bir karşılığı; yalnızca bekleme metni için) */
const MARKET_QUESTION = /piyasa|haber|gündem|gundem|ekonomi|enflasyon|faiz|döviz|doviz|\bkur|dolar|euro|emtia|hammadde|resesyon|kriz/i

const MAX_LENGTH = 500
/** Bu genişliğin altında panel tam ekran açılır. */
const MOBILE_QUERY = '(max-width: 600px)'
/** Cevap gelince karakterin sevinç animasyonunun süresi (ms). */
const HAPPY_MS = 1600
/** Karşılama balonu: sayfa açıldıktan sonra görünme gecikmesi ve ekranda kalma süresi (ms). */
const GREETING_DELAY_MS = 1500
const GREETING_VISIBLE_MS = 9000
const GREETED_KEY = 'clario-assistant-greeted'

function alreadyGreeted(): boolean {
  try {
    return sessionStorage.getItem(GREETED_KEY) === '1'
  } catch {
    return false
  }
}

function markGreeted() {
  try {
    sessionStorage.setItem(GREETED_KEY, '1')
  } catch {
    // Depolama kapalıysa karşılama her açılışta gösterilir; sorun değil.
  }
}

/**
 * Clario Asistan: her sayfanın sağ altında duran sohbet balonu.
 * Uygulama düzeyinde bir kez yerleştirilir; sayfa değişse de sohbet geçmişi korunur.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<false | 'analysis' | 'market'>(false)
  const [happy, setHappy] = useState(false)
  const [greeting, setGreeting] = useState(false)
  const nextId = useRef(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  // Oturumda bir kez, karakter kendini kısa bir balonla tanıtır.
  useEffect(() => {
    if (alreadyGreeted()) return
    const show = setTimeout(() => setGreeting(true), GREETING_DELAY_MS)
    const hide = setTimeout(() => setGreeting(false), GREETING_DELAY_MS + GREETING_VISIBLE_MS)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [])

  useEffect(() => {
    if (!happy) return
    const timer = setTimeout(() => setHappy(false), HAPPY_MS)
    return () => clearTimeout(timer)
  }, [happy])

  // Açılınca yazma alanına odaklan; Esc ile kapat ve odağı balona geri ver.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, pending, open])

  function openPanel() {
    setOpen(true)
    setGreeting(false)
    markGreeted()
  }

  function dismissGreeting() {
    setGreeting(false)
    markGreeted()
  }

  function close() {
    setOpen(false)
    launcherRef.current?.focus()
  }

  const append = (message: Omit<ChatMessage, 'id'>) =>
    setMessages((list) => [...list, { ...message, id: nextId.current++ }])

  async function send(raw: string) {
    const question = raw.trim()
    if (!question || pending) return

    append({ role: 'user', text: question })
    setInput('')
    setPending(MARKET_QUESTION.test(question) ? 'market' : 'analysis')

    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const response = await askAssistant(question, controller.signal)
      append({ role: 'assistant', text: response.answer, response })
      setHappy(response.intent !== 'unknown')
    } catch (error) {
      if (isAbortError(error)) return
      append({ role: 'assistant', text: toApiError(error).message, isError: true })
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send(input)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(input)
    }
  }

  // Mobilde panel tüm ekranı kapladığı için, bir sayfaya gidilince panel kapanır.
  function handleNavigate() {
    if (window.matchMedia(MOBILE_QUERY).matches) setOpen(false)
  }

  const orbState: OrbState = pending ? 'thinking' : happy ? 'happy' : 'idle'
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.response)
  const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.text))
  const followUps = (lastAssistant?.response?.suggestions ?? []).filter((q) => !asked.has(q))

  return (
    <>
      {open && (
        <section id="assistant-panel" className="assistant-panel" role="dialog" aria-label="Clario Asistan">
          <header className="assistant-header">
            <AssistantOrb size={40} state={orbState} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="assistant-title">Clario Asistan</div>
              <div className="assistant-subtitle">Cevaplar gerçek verinizin analizine dayanır</div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                className="assistant-header-button"
                onClick={() => setMessages([])}
                disabled={pending !== false}
                title="Sohbeti temizle"
                aria-label="Sohbeti temizle"
              >
                <TrashIcon size={16} />
              </button>
            )}
            <button type="button" className="assistant-header-button" onClick={close} title="Kapat (Esc)" aria-label="Asistanı kapat">
              <CloseIcon size={18} />
            </button>
          </header>

          <div className="chat-messages" ref={scrollRef} aria-live="polite">
            {messages.length === 0 ? (
              <Welcome onAsk={(q) => void send(q)} />
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} onNavigate={handleNavigate} />)
            )}

            {pending && (
              <div className="message assistant">
                <div className="bubble" aria-label="Analiz ediliyor">
                  <span className="typing">
                    <span />
                    <span />
                    <span />
                  </span>
                  {pending === 'market' && <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>Güncel gündem taranıyor…</div>}
                </div>
              </div>
            )}

            {!pending && followUps.length > 0 && (
              <div className="chips">
                {followUps.map((q) => (
                  <button key={q} type="button" className="chip" onClick={() => void send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <label htmlFor="assistant-input" className="visually-hidden">
              Sorunuz
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              className="chat-input"
              rows={1}
              value={input}
              maxLength={MAX_LENGTH}
              placeholder="Bir soru sorun…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" className="button button-primary" disabled={pending !== false || !input.trim()} aria-label="Gönder">
              <SendIcon size={16} />
            </button>
          </form>
        </section>
      )}

      {greeting && !open && (
        <div className="orb-greeting" role="status">
          <button type="button" className="orb-greeting-text" onClick={openPanel}>
            <strong>Merhaba, ben Clario!</strong>
            <span>Satışlar, stok ya da müşteriler hakkında bana soru sorabilirsiniz.</span>
          </button>
          <button type="button" className="orb-greeting-close" onClick={dismissGreeting} aria-label="Karşılama mesajını kapat">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={`assistant-launcher${open ? ' open' : ''}`}
        onClick={() => (open ? close() : openPanel())}
        aria-expanded={open}
        aria-controls="assistant-panel"
        aria-label={open ? 'Asistanı kapat' : 'Clario Asistan’ı aç'}
        title="Clario Asistan"
      >
        <span className="orb-float">
          <AssistantOrb size={64} state={orbState} tracking />
        </span>
        <span className="orb-shadow" aria-hidden="true" />      </button>
    </>
  )
}

function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  const examples = useApi(getAssistantExamples)
  const questions = examples.data?.examples ?? FALLBACK_EXAMPLES

  return (
    <div className="welcome">
      <div className="state-title">Merhaba! İşletmeniz hakkında ne öğrenmek istersiniz?</div>
      <p>
        Satış, stok, müşteri kaybı, risk, fırsat, marj, giderler, departman/proje veya güncel piyasa durumu hakkında sorabilirsiniz.
        Bölge ya da ürün adı yazarsanız cevap ona göre filtrelenir.
      </p>
      <div className="chips" style={{ justifyContent: 'center' }}>
        {questions.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({ message, onNavigate }: { message: ChatMessage; onNavigate: () => void }) {
  const { response } = message
  const customerId = response?.intent === 'customer' ? (response.data as { customerId?: number } | null)?.customerId : undefined
  const page = customerId ? { to: `/reports?period=all&customerId=${customerId}`, label: 'Müşteri raporu' } : response ? INTENT_PAGES[response.intent] : undefined
  const className = `message ${message.role}${message.isError ? ' error' : ''}`

  return (
    <div className={className}>
      <div className="bubble">
        {message.text.split('\n').map((line, i) => (
          <div key={i} className={`answer-line${line.startsWith('• ') ? ' bullet' : ''}`}>
            {line || ' '}
          </div>
        ))}
        {response && response.sources.length > 0 && <SourceList sources={response.sources} />}
        {response?.intent === 'statement' && <StatementDownloads data={response.data} onNavigate={onNavigate} />}
      </div>

      {response && response.intent !== 'unknown' && response.intent !== 'greeting' && (
        <div className="message-meta">
          <Badge tone="accent">{response.intentLabel}</Badge>
          <span title="En iyi eşleşen analizin diğerlerine göre baskınlığı">güven %{Math.round(response.confidence * 100)}</span>
          {page && (
            <Link to={page.to} onClick={onNavigate}>
              {page.label} →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** Güncel haberlere dayanan cevapların kaynakları (yeni sekmede açılır). */
interface StatementAttachment {
  statement: { kind: string; query: string; title: string; formats: StatementFormat[] }
}

const FORMAT_LABELS: Record<StatementFormat, string> = { excel: 'Excel', pdf: 'PDF', word: 'Word' }

/** Asistandan istenen rapor/ekstre: indirme düğmeleri ve Raporlar'da açma bağlantısı */
function StatementDownloads({ data, onNavigate }: { data: unknown; onNavigate: () => void }) {
  const [busy, setBusy] = useState<StatementFormat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statement = (data as StatementAttachment | null)?.statement
  if (!statement) return null

  async function download(format: StatementFormat) {
    setBusy(format)
    setError(null)
    try {
      await downloadStatementAs(statement!.query, format)
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="statement-attachment">
      <div className="statement-attachment-buttons">
        {statement.formats.map((format, i) => (
          <button
            key={format}
            type="button"
            className={`button button-small${i === 0 ? ' button-primary' : ''}`}
            disabled={busy !== null}
            onClick={() => void download(format)}
          >
            {busy === format ? 'Hazırlanıyor…' : `${FORMAT_LABELS[format]} indir`}
          </button>
        ))}
      </div>
      <Link to={`/reports?view=statements&${statement.query}`} onClick={onNavigate}>
        Raporlar'da aç →
      </Link>
      {error && <div className="statement-error">{error}</div>}
    </div>
  )
}

export function SourceList({ sources }: { sources: SourceLink[] }) {
  return (
    <div className="sources">
      <div className="sources-title">Kaynaklar</div>
      <ol>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title}
            </a>
            <span className="faint"> · {new URL(source.url).hostname.replace(/^www\./, '')}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
