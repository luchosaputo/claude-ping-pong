import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { remarkLineData } from './markdown.js'

interface Props {
  fileId: string
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string }

type SelectionState =
  | { kind: 'none' }
  | { kind: 'valid'; block: Element; buttonX: number; buttonY: number }
  | { kind: 'cross-block'; tooltipX: number; tooltipY: number }
  | {
    kind: 'composing'
    cardY: number
    selectedText: string
    prefixContext: string
    suffixContext: string
    lineRangeStart: number
    lineRangeEnd: number
    saving?: boolean
    saveError?: string
  }

interface Message {
  id: string
  author: 'user' | 'agent'
  body: string
  createdAt: number
}

interface Thread {
  threadId: string
  selectedText: string
  lineRangeStart: number
  lineRangeEnd: number
  messages: Message[]
  createdAt: number
}

const CARD_GAP = 8

function findBlockAncestor(node: Node, root: Element): Element | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  while (el && el !== root) {
    if (el instanceof Element && el.hasAttribute('data-line-start')) return el
    el = el.parentElement
  }
  return null
}

function extractSelectionData(sel: Selection, block: Element, cardY: number): Extract<SelectionState, { kind: 'composing' }> {
  const range = sel.getRangeAt(0)
  const selectedText = sel.toString()

  const prefixRange = document.createRange()
  prefixRange.selectNodeContents(block)
  prefixRange.setEnd(range.startContainer, range.startOffset)
  const prefixContext = prefixRange.toString().slice(-50)

  const suffixRange = document.createRange()
  suffixRange.setStart(range.endContainer, range.endOffset)
  suffixRange.selectNodeContents(block)
  suffixRange.setStart(range.endContainer, range.endOffset)
  const suffixContext = suffixRange.toString().slice(0, 50)

  const lineRangeStart = parseInt(block.getAttribute('data-line-start') ?? '0', 10)
  const lineRangeEnd = parseInt(block.getAttribute('data-line-end') ?? '0', 10)

  return { kind: 'composing', cardY, selectedText, prefixContext, suffixContext, lineRangeStart, lineRangeEnd }
}

export default function Viewer({ fileId }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [commentText, setCommentText] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [cardPositions, setCardPositions] = useState<Map<string, number>>(new Map())

  const articleRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const posRafRef = useRef<number | null>(null)

  // Expose latest threads to the stable scroll handler without re-registering
  const threadsRef = useRef<Thread[]>(threads)
  threadsRef.current = threads

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/files/${fileId}/content`)
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(b.error ?? res.statusText))
        return res.text()
      })
      .then((content) => setState({ status: 'ready', content }))
      .catch((err) => setState({ status: 'error', message: String(err) }))
  }, [fileId])

  function loadThreads() {
    fetch(`/api/files/${fileId}/threads`)
      .then((r) => (r.ok ? (r.json() as Promise<Thread[]>) : Promise.reject()))
      .then(setThreads)
      .catch(() => {})
  }

  useEffect(() => {
    if (state.status === 'ready') loadThreads()
  }, [state.status])

  // ── Position algorithm ────────────────────────────────────────────────────

  const computePositions = useCallback(() => {
    const article = articleRef.current
    if (!article) return

    const entries = threadsRef.current
      .map((thread) => {
        const block = article.querySelector(
          `[data-line-start="${thread.lineRangeStart}"]`
        ) as HTMLElement | null
        const idealTop = block
          ? block.getBoundingClientRect().top + window.scrollY
          : 0
        const cardEl = cardEls.current.get(thread.threadId)
        const height = cardEl?.offsetHeight ?? 80
        return { threadId: thread.threadId, idealTop, height }
      })
      .sort((a, b) => a.idealTop - b.idealTop)

    const positions = new Map<string, number>()
    let nextAvailable = 0

    for (const { threadId, idealTop, height } of entries) {
      const top = Math.max(idealTop, nextAvailable)
      positions.set(threadId, top)
      nextAvailable = top + height + CARD_GAP
    }

    setCardPositions(positions)
  }, []) // stable: reads from refs only

  // Recompute after threads load or content renders
  useLayoutEffect(() => {
    computePositions()
  }, [threads, state.status, computePositions])

  // RAF-debounced scroll listener
  useEffect(() => {
    function onScroll() {
      if (posRafRef.current !== null) cancelAnimationFrame(posRafRef.current)
      posRafRef.current = requestAnimationFrame(() => {
        computePositions()
        posRafRef.current = null
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (posRafRef.current !== null) cancelAnimationFrame(posRafRef.current)
    }
  }, [computePositions])

  // ── Selection handling ────────────────────────────────────────────────────

  useEffect(() => {
    const article = articleRef.current
    if (!article) return

    function handleMouseUp() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection((prev) => (prev.kind === 'composing' ? prev : { kind: 'none' }))
        return
      }

      const range = sel.getRangeAt(0)
      const anchorBlock = findBlockAncestor(sel.anchorNode!, article!)
      const focusBlock = findBlockAncestor(sel.focusNode!, article!)

      if (!anchorBlock || !focusBlock) {
        setSelection((prev) => (prev.kind === 'composing' ? prev : { kind: 'none' }))
        return
      }

      if (anchorBlock === focusBlock) {
        const rect = range.getBoundingClientRect()
        setSelection({
          kind: 'valid',
          block: anchorBlock,
          buttonX: rect.right,
          buttonY: rect.top + window.scrollY - 4,
        })
      } else {
        const rect = range.getBoundingClientRect()
        setSelection({
          kind: 'cross-block',
          tooltipX: rect.left + rect.width / 2,
          tooltipY: rect.top + window.scrollY - 36,
        })
      }
    }

    function handleSelectionChange() {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setSelection((prev) => (prev.kind === 'none' || prev.kind === 'composing' ? prev : { kind: 'none' }))
      }
    }

    article.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      article.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [state.status])

  useEffect(() => {
    if (selection.kind === 'composing') {
      setTimeout(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.focus()
      }, 0)
    }
  }, [selection.kind])

  // ── Comment actions ───────────────────────────────────────────────────────

  function handleAddCommentClick() {
    if (selection.kind !== 'valid') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const cardY = rect.top + window.scrollY

    setSelection(extractSelectionData(sel, selection.block, cardY))
    setCommentText('')
  }

  function handleCancel() {
    setSelection({ kind: 'none' })
    setCommentText('')
  }

  async function handleSave() {
    if (selection.kind !== 'composing' || selection.saving) return
    const payload = {
      fileId,
      selectedText: selection.selectedText,
      prefixContext: selection.prefixContext,
      suffixContext: selection.suffixContext,
      lineRangeStart: selection.lineRangeStart,
      lineRangeEnd: selection.lineRangeEnd,
      body: commentText,
    }
    setSelection((prev) => prev.kind === 'composing' ? { ...prev, saving: true, saveError: undefined } : prev)
    try {
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        setSelection((prev) => prev.kind === 'composing' ? { ...prev, saving: false, saveError: err.error } : prev)
        return
      }
      setSelection({ kind: 'none' })
      setCommentText('')
      loadThreads()
    } catch (err) {
      setSelection((prev) => prev.kind === 'composing' ? { ...prev, saving: false, saveError: 'Error de red al guardar.' } : prev)
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commentText.trim()) {
      handleSave()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state.status === 'loading') return <div style={styles.message}>Loading…</div>
  if (state.status === 'error') return <div style={styles.message}>Error: {state.message}</div>

  const asideOffsetLeft = asideRef.current?.offsetLeft ?? 0

  return (
    <div style={styles.layout}>
      <article ref={articleRef} style={styles.document}>
        <ReactMarkdown remarkPlugins={[remarkLineData]}>
          {state.content}
        </ReactMarkdown>
      </article>

      <aside ref={asideRef} style={styles.sidebar} />

      {/* Existing thread cards */}
      {threads.map((thread) => {
        const top = cardPositions.get(thread.threadId) ?? 0
        return (
          <div
            key={thread.threadId}
            ref={(el) => {
              if (el) cardEls.current.set(thread.threadId, el)
              else cardEls.current.delete(thread.threadId)
            }}
            style={{
              ...styles.threadCard,
              top,
              left: asideOffsetLeft,
              visibility: cardPositions.size === 0 ? 'hidden' : 'visible',
            }}
          >
            <div style={styles.quotedText}>
              "{thread.selectedText.length > 80
                ? thread.selectedText.slice(0, 80) + '…'
                : thread.selectedText}"
            </div>
            <div style={styles.messageList}>
              {thread.messages.map((msg, i) => (
                <div
                  key={msg.id}
                  style={{
                    ...styles.message_,
                    ...(i > 0 ? styles.messageSeparated : {}),
                  }}
                >
                  <span style={{
                    ...styles.authorLabel,
                    ...(msg.author === 'agent' ? styles.authorAgent : styles.authorUser),
                  }}>
                    {msg.author === 'agent' ? 'Agent' : 'You'}
                  </span>
                  <p style={styles.messageBody}>{msg.body}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {selection.kind === 'valid' && (
        <button
          title="Agregar comentario"
          style={{
            ...styles.addCommentBtn,
            left: selection.buttonX,
            top: selection.buttonY,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddCommentClick}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {selection.kind === 'cross-block' && (
        <div
          style={{
            ...styles.tooltip,
            left: selection.tooltipX,
            top: selection.tooltipY,
          }}
        >
          Los comentarios deben estar dentro de un mismo párrafo.
        </div>
      )}

      {selection.kind === 'composing' && (
        <div
          style={{
            ...styles.commentCard,
            top: selection.cardY,
            left: asideOffsetLeft,
          }}
        >
          <div style={styles.quotedText}>
            "{selection.selectedText.length > 80
              ? selection.selectedText.slice(0, 80) + '…'
              : selection.selectedText}"
          </div>

          <div style={styles.inputRow}>
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              placeholder="Agregar un comentario…"
              value={commentText}
              onChange={(e) => {
                setCommentText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onKeyDown={handleTextareaKeyDown}
              rows={1}
            />
          </div>

          {selection.saveError && (
            <div style={styles.saveError}>{selection.saveError}</div>
          )}

          <div style={styles.actions}>
            <button
              style={styles.cancelBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
              disabled={selection.saving}
            >
              Cancelar
            </button>
            <button
              style={{
                ...styles.saveBtn,
                opacity: (commentText.trim() && !selection.saving) ? 1 : 0.5,
                cursor: (commentText.trim() && !selection.saving) ? 'pointer' : 'default',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSave}
              disabled={!commentText.trim() || selection.saving}
            >
              {selection.saving ? 'Guardando…' : 'Comentar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  layout: {
    display: 'flex',
    alignItems: 'flex-start',
    minHeight: '100vh',
    padding: '48px 24px',
    boxSizing: 'border-box' as const,
    gap: '24px',
    position: 'relative' as const,
  },
  document: {
    flex: '0 1 860px',
    minWidth: 0,
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    lineHeight: '1.7',
    color: 'var(--text)',
  },
  sidebar: {
    flex: '0 0 240px',
  },
  message: {
    padding: '48px 24px',
    color: 'var(--muted)',
    fontFamily: 'sans-serif',
  },
  threadCard: {
    position: 'absolute' as const,
    width: '260px',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    boxShadow: '0 2px 8px var(--card-shadow)',
    padding: '12px',
    zIndex: 50,
    fontFamily: 'Roboto, Arial, sans-serif',
    transition: 'top 0.15s ease',
  },
  messageList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0',
  },
  message_: {
    paddingTop: '4px',
  },
  messageSeparated: {
    borderTop: '1px solid var(--card-border)',
    paddingTop: '8px',
    marginTop: '8px',
  },
  authorLabel: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: '700' as const,
    letterSpacing: '0.02em',
    marginBottom: '2px',
    textTransform: 'uppercase' as const,
  },
  authorUser: {
    color: 'var(--accent)',
  },
  authorAgent: {
    color: 'var(--muted)',
  },
  messageBody: {
    margin: '0',
    fontSize: '13px',
    lineHeight: '1.5',
    color: 'var(--text)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  addCommentBtn: {
    position: 'absolute' as const,
    transform: 'translateY(-100%)',
    marginLeft: '8px',
    background: 'var(--accent)',
    color: 'var(--accent-btn-text, #fff)',
    fontSize: '12px',
    fontFamily: 'sans-serif',
    fontWeight: '600' as const,
    padding: '5px 7px',
    lineHeight: '0',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    zIndex: 100,
    boxShadow: '0 2px 6px var(--card-shadow)',
    userSelect: 'none' as const,
  },
  tooltip: {
    position: 'absolute' as const,
    transform: 'translateX(-50%)',
    background: '#cc2222',
    color: '#fff',
    fontSize: '13px',
    padding: '6px 12px',
    borderRadius: '6px',
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const,
    zIndex: 100,
    boxShadow: '0 2px 8px var(--card-shadow)',
  },
  commentCard: {
    position: 'absolute' as const,
    width: '260px',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px var(--card-shadow)',
    padding: '12px',
    zIndex: 200,
    fontFamily: 'Roboto, Arial, sans-serif',
  },
  quotedText: {
    fontSize: '12px',
    color: 'var(--muted)',
    fontStyle: 'italic' as const,
    borderLeft: '3px solid var(--quote-border)',
    paddingLeft: '8px',
    marginBottom: '10px',
    lineHeight: '1.5',
  },
  inputRow: {
    marginBottom: '8px',
  },
  textarea: {
    width: '100%',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '13px',
    lineHeight: '1.5',
    color: 'var(--text)',
    background: 'transparent',
    padding: '4px 0',
    borderBottom: '2px solid var(--accent)',
    overflow: 'hidden',
  },
  saveError: {
    fontSize: '12px',
    color: '#cc2222',
    marginBottom: '6px',
    lineHeight: '1.4',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '4px',
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    fontSize: '13px',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeight: '500' as const,
    padding: '6px 12px',
    borderRadius: '4px',
    userSelect: 'none' as const,
  },
  saveBtn: {
    background: 'var(--accent)',
    color: 'var(--accent-btn-text, #fff)',
    border: 'none',
    fontSize: '13px',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeight: '500' as const,
    padding: '6px 16px',
    borderRadius: '4px',
    userSelect: 'none' as const,
  },
} as const
