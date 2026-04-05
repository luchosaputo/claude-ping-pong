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

function findBlockAncestor(node: Node, root: Element): Element | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  while (el && el !== root) {
    if (el instanceof Element && el.hasAttribute('data-line-start')) return el
    el = el.parentElement
  }
  return null
}

export default function Viewer({ fileId }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const articleRef = useRef<HTMLElement>(null)

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
        setSelection({ kind: 'none' })
        return
      }

      const range = sel.getRangeAt(0)
      const anchorBlock = findBlockAncestor(sel.anchorNode!, article!)
      const focusBlock = findBlockAncestor(sel.focusNode!, article!)

      if (!anchorBlock || !focusBlock) {
        setSelection({ kind: 'none' })
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
        setSelection((prev) => (prev.kind === 'none' ? prev : { kind: 'none' }))
      }
    }

    article.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      article.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [state.status])

  if (state.status === 'loading') return <div style={styles.message}>Loading…</div>
  if (state.status === 'error') return <div style={styles.message}>Error: {state.message}</div>

  return (
    <div style={styles.layout}>
      <article ref={articleRef} style={styles.document}>
        <ReactMarkdown remarkPlugins={[remarkLineData]}>
          {state.content}
        </ReactMarkdown>
      </article>
      <aside style={styles.sidebar} />
      {selection.kind === 'valid' && (
        <button
          title="Agregar comentario"
          style={{
            ...styles.addCommentBtn,
            left: selection.buttonX,
            top: selection.buttonY,
          }}
          onMouseDown={(e) => e.preventDefault()}
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
    background: '#1a73e8',
    color: '#fff',
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
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
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
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  },
} as const
