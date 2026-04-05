import { useEffect, useRef, useState } from 'react'
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
  }

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
  const articleRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch(`/api/files/${fileId}/content`)
      .then((res) => {
        if (!res.ok) return res.json().then((b) => Promise.reject(b.error ?? res.statusText))
        return res.text()
      })
      .then((content) => setState({ status: 'ready', content }))
      .catch((err) => setState({ status: 'error', message: String(err) }))
  }, [fileId])

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

  function handleSave() {
    if (selection.kind !== 'composing') return
    const payload = {
      selectedText: selection.selectedText,
      prefixContext: selection.prefixContext,
      suffixContext: selection.suffixContext,
      lineRangeStart: selection.lineRangeStart,
      lineRangeEnd: selection.lineRangeEnd,
      body: commentText,
    }
    console.log('[ping-pong] comment payload:', payload)
    setSelection({ kind: 'none' })
    setCommentText('')
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commentText.trim()) {
      handleSave()
    }
  }

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

          <div style={styles.actions}>
            <button
              style={styles.cancelBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
            >
              Cancelar
            </button>
            <button
              style={{
                ...styles.saveBtn,
                opacity: commentText.trim() ? 1 : 0.5,
                cursor: commentText.trim() ? 'pointer' : 'default',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSave}
              disabled={!commentText.trim()}
            >
              Comentar
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
    flex: '0 1 720px',
    minWidth: 0,
    fontFamily: 'Georgia, serif',
    fontSize: '16px',
    lineHeight: '1.7',
    color: 'var(--text)',
  },
  sidebar: {
    flex: '0 0 320px',
  },
  message: {
    padding: '48px 24px',
    color: 'var(--muted)',
    fontFamily: 'sans-serif',
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
    width: '300px',
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
