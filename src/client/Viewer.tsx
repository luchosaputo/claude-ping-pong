import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { remarkLineData } from './markdown.js'
import remarkGfm from 'remark-gfm'
import { computeThreadCardPositions } from './threadPositions.js'

type Theme = 'system' | 'light' | 'dark'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = (localStorage.getItem('theme') as Theme) ?? 'system'
    applyTheme(saved)  // apply synchronously to avoid flash on load
    return saved
  })

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const cycle = () => setTheme(t => t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system')

  return { theme, cycle }
}

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
  prefixContext: string | null
  suffixContext: string | null
  lineRangeStart: number
  lineRangeEnd: number
  messages: Message[]
  createdAt: number
}

interface ThreadUpdatedEvent {
  fileId: string
  threadId: string
  type: 'reply' | 'resolve'
  timestamp: number
}

interface FileChangedEvent {
  fileId: string
  timestamp: number
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

// ── Text anchoring helpers ────────────────────────────────────────────────

/**
 * Convert a character offset within a DOM subtree's textContent to a Range.
 * Walks text nodes accumulating lengths until the start and end positions are found.
 */
function charOffsetToRange(root: Element, startOffset: number, length: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startNode: Text | null = null
  let startNodeOffset = 0
  let endNode: Text | null = null
  let endNodeOffset = 0

  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const len = text.length
    const nodeEnd = pos + len

    if (startNode === null && nodeEnd > startOffset) {
      startNode = text
      startNodeOffset = startOffset - pos
    }
    if (startNode !== null && nodeEnd >= startOffset + length) {
      endNode = text
      endNodeOffset = startOffset + length - pos
      break
    }
    pos += len
  }

  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startNodeOffset)
  range.setEnd(endNode, endNodeOffset)
  return range
}

/**
 * Find the Range for selectedText inside a block element.
 * First tries exact match (using prefix+suffix for disambiguation).
 * Falls back to a simple indexOf match.
 * Returns null when the text can no longer be located (orphan).
 */
function findTextRange(
  block: Element,
  selectedText: string,
  prefixContext: string | null,
  suffixContext: string | null,
): Range | null {
  const fullText = block.textContent ?? ''

  // Try context-assisted disambiguation first
  if (prefixContext !== null && suffixContext !== null) {
    const needle = prefixContext + selectedText + suffixContext
    const idx = fullText.indexOf(needle)
    if (idx !== -1) {
      return charOffsetToRange(block, idx + prefixContext.length, selectedText.length)
    }
  }

  // Plain exact match (first occurrence)
  const idx = fullText.indexOf(selectedText)
  if (idx !== -1) {
    return charOffsetToRange(block, idx, selectedText.length)
  }

  // Normalised whitespace fallback
  const normalFull = fullText.replace(/\s+/g, ' ')
  const normalSelected = selectedText.replace(/\s+/g, ' ').trim()
  if (normalSelected.length > 0) {
    const normalIdx = normalFull.indexOf(normalSelected)
    if (normalIdx !== -1) {
      return charOffsetToRange(block, normalIdx, normalSelected.length)
    }
  }

  return null
}

/** Wrap the given Range in a <mark data-thread-id="…"> element. */
function wrapRangeWithMark(range: Range, threadId: string): void {
  const mark = document.createElement('mark')
  mark.dataset.threadId = threadId
  try {
    range.surroundContents(mark)
  } catch {
    // Range partially overlaps element boundaries — extract then re-insert
    const fragment = range.extractContents()
    mark.appendChild(fragment)
    range.insertNode(mark)
  }
}

/** Remove all mark elements applied by this component, normalising text nodes after. */
function removeAllMarks(article: HTMLElement): void {
  const marks = Array.from(article.querySelectorAll<HTMLElement>('mark[data-thread-id]'))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  // Merge text nodes that were split during previous wrapping operations
  article.normalize()
}

function getCandidateBlocks(article: HTMLElement, thread: Thread): HTMLElement[] {
  const allBlocks = Array.from(article.querySelectorAll<HTMLElement>('[data-line-start]'))
  const candidates: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  function add(block: HTMLElement) {
    if (seen.has(block)) return
    seen.add(block)
    candidates.push(block)
  }

  for (const block of allBlocks) {
    const start = Number.parseInt(block.getAttribute('data-line-start') ?? '', 10)
    if (start === thread.lineRangeStart) add(block)
  }

  for (const block of allBlocks) {
    const start = Number.parseInt(block.getAttribute('data-line-start') ?? '', 10)
    const end = Number.parseInt(block.getAttribute('data-line-end') ?? '', 10)
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    if (start <= thread.lineRangeStart && end >= thread.lineRangeEnd) add(block)
  }

  for (const block of allBlocks) add(block)

  return candidates
}

function findThreadAnchor(article: HTMLElement, thread: Thread): { block: HTMLElement; range: Range } | null {
  for (const block of getCandidateBlocks(article, thread)) {
    const range = findTextRange(block, thread.selectedText, thread.prefixContext, thread.suffixContext)
    if (range) return { block, range }
  }

  return null
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l4.5 4.5" strokeOpacity="0" />
      <path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function Viewer({ fileId }: Props) {
  const { theme, cycle: cycleTheme } = useTheme()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' })
  const [commentText, setCommentText] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [cardPositions, setCardPositions] = useState<Map<string, number>>(new Map())
  const [orphanedThreadIds, setOrphanedThreadIds] = useState<Set<string>>(new Set())
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set())
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySaving, setReplySaving] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [messageEditText, setMessageEditText] = useState('')
  const [messageEditSaving, setMessageEditSaving] = useState(false)
  const [messageEditError, setMessageEditError] = useState<string | null>(null)

  const articleRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingCardRef = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLDivElement>())
  const anchoredBlocksRef = useRef(new Map<string, HTMLElement>())
  const contentRequestIdRef = useRef(0)
  const posRafRef = useRef<number | null>(null)

  // Expose latest threads to the stable scroll handler without re-registering
  const threadsRef = useRef<Thread[]>(threads)
  threadsRef.current = threads
  const selectionRef = useRef<SelectionState>(selection)
  selectionRef.current = selection
  const orphanedThreadIdsRef = useRef<Set<string>>(orphanedThreadIds)
  orphanedThreadIdsRef.current = orphanedThreadIds
  const activeThreadIdRef = useRef<string | null>(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const contentVersion = state.status === 'ready' ? state.content : ''
  const latestContentRef = useRef(contentVersion)
  latestContentRef.current = contentVersion

  // ── Data loading ──────────────────────────────────────────────────────────

  const fetchContent = useCallback(async () => {
    const res = await fetch(`/api/files/${fileId}/content`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
      throw new Error(body.error ?? res.statusText)
    }
    return res.text()
  }, [fileId])

  const loadContent = useCallback(async () => {
    const requestId = ++contentRequestIdRef.current
    try {
      const content = await fetchContent()
      if (contentRequestIdRef.current !== requestId) return
      setState({ status: 'ready', content })
    } catch (err) {
      if (contentRequestIdRef.current !== requestId) return
      setState({ status: 'error', message: String(err) })
    }
  }, [fetchContent])

  useEffect(() => {
    setState({ status: 'loading' })
    void loadContent()
  }, [fileId, loadContent])

  function loadThreads() {
    fetch(`/api/files/${fileId}/threads`)
      .then((r) => (r.ok ? (r.json() as Promise<Thread[]>) : Promise.reject()))
      .then((nextThreads) => {
        setThreads(nextThreads)
        setUnreadThreadIds((prev) => {
          const nextIds = new Set(nextThreads.map((thread) => thread.threadId))
          return new Set(Array.from(prev).filter((threadId) => nextIds.has(threadId)))
        })
      })
      .catch(() => { })
  }

  useEffect(() => {
    if (state.status === 'ready') loadThreads()
  }, [state.status])

  useEffect(() => {
    const eventSource = new EventSource(`/api/events/${fileId}`)

    function handlePing(_event: MessageEvent<string>) {
      // Keep the SSE channel exercised now; later stages will react to server-side events here.
    }

    function handleThreadUpdated(_event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(_event.data) as ThreadUpdatedEvent
        if (payload.type === 'reply' && activeThreadIdRef.current !== payload.threadId) {
          setUnreadThreadIds((prev) => new Set(prev).add(payload.threadId))
        }
      } catch {
        // Ignore malformed SSE payloads and still refresh from source of truth.
      }
      loadThreads()
    }

    async function handleFileChanged(event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(event.data) as FileChangedEvent
        if (payload.fileId !== fileId) return
      } catch {
        // Reload anyway: the event type is enough to know content may be stale.
      }
      if (articleRef.current) removeAllMarks(articleRef.current)
      setSelection({ kind: 'none' })
      setCommentText('')
      await loadContent()
    }

    eventSource.addEventListener('ping', handlePing as EventListener)
    eventSource.addEventListener('thread:updated', handleThreadUpdated as EventListener)
    eventSource.addEventListener('file:changed', handleFileChanged as unknown as EventListener)

    return () => {
      eventSource.removeEventListener('ping', handlePing as EventListener)
      eventSource.removeEventListener('thread:updated', handleThreadUpdated as EventListener)
      eventSource.removeEventListener('file:changed', handleFileChanged as unknown as EventListener)
      eventSource.close()
    }
  }, [fileId, loadContent])

  useEffect(() => {
    if (state.status !== 'ready') return

    const interval = window.setInterval(() => {
      const requestId = ++contentRequestIdRef.current
      void fetchContent()
        .then((nextContent) => {
          if (contentRequestIdRef.current !== requestId) return
          if (nextContent === latestContentRef.current) return
          if (articleRef.current) removeAllMarks(articleRef.current)
          setSelection({ kind: 'none' })
          setCommentText('')
          setState({ status: 'ready', content: nextContent })
        })
        .catch(() => { })
    }, 2000)

    return () => window.clearInterval(interval)
  }, [fetchContent, fileId, state.status])

  // ── Position algorithm ────────────────────────────────────────────────────

  const computePositions = useCallback(() => {
    const article = articleRef.current
    if (!article) return

    const entries = threadsRef.current
      .map((thread) => {
        // Prefer the <mark> anchor (precise) over the block fallback
        const mark = article.querySelector(
          `mark[data-thread-id="${thread.threadId}"]`
        ) as HTMLElement | null
        const anchor = mark ?? anchoredBlocksRef.current.get(thread.threadId) ?? null
        const isOrphaned = orphanedThreadIdsRef.current.has(thread.threadId)
        const idealTop = anchor
          ? anchor.getBoundingClientRect().top + window.scrollY
          : (isOrphaned ? window.scrollY + 24 : 0)
        const cardEl = cardEls.current.get(thread.threadId)
        const height = cardEl?.offsetHeight ?? 80
        return { threadId: thread.threadId, idealTop, height }
      })
    const draftCard = selectionRef.current?.kind === 'composing'
      ? {
        top: selectionRef.current.cardY,
        height: composingCardRef.current?.offsetHeight ?? 160,
      }
      : undefined
    const positions = computeThreadCardPositions(entries, draftCard)

    setCardPositions(positions)
  }, []) // stable: reads from refs only

  // Apply marks and recompute positions after threads load or content renders
  useLayoutEffect(() => {
    if (state.status !== 'ready') return
    const article = articleRef.current
    if (!article) return

    // Remove stale marks first, then re-anchor every thread
    removeAllMarks(article)
    anchoredBlocksRef.current.clear()
    const nextOrphanedThreadIds = new Set<string>()
    for (const thread of threadsRef.current) {
      const anchor = findThreadAnchor(article, thread)
      if (!anchor) {
        nextOrphanedThreadIds.add(thread.threadId)
        continue
      }
      anchoredBlocksRef.current.set(thread.threadId, anchor.block)
      wrapRangeWithMark(anchor.range, thread.threadId)
    }
    orphanedThreadIdsRef.current = nextOrphanedThreadIds
    setOrphanedThreadIds((prev) => (setsEqual(prev, nextOrphanedThreadIds) ? prev : nextOrphanedThreadIds))

    computePositions()
  }, [threads, state.status, contentVersion, computePositions])

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

  // ── Active thread interaction ─────────────────────────────────────────────

  function activateThread(threadId: string): void {
    setUnreadThreadIds((prev) => {
      if (!prev.has(threadId)) return prev
      const next = new Set(prev)
      next.delete(threadId)
      return next
    })
    setActiveThreadId(threadId)
  }

  // Delegated click on <mark> elements (marks are created imperatively, so per-element listeners would leak)
  useEffect(() => {
    const article = articleRef.current
    if (!article || state.status !== 'ready') return

    function handleMarkClick(e: MouseEvent) {
      const mark = (e.target as Element).closest<HTMLElement>('mark[data-thread-id]')
      if (!mark) return
      e.stopPropagation()
      const threadId = mark.dataset.threadId!
      setActiveThreadId((prev) => {
        if (prev === threadId) return null
        setUnreadThreadIds((current) => {
          if (!current.has(threadId)) return current
          const next = new Set(current)
          next.delete(threadId)
          return next
        })
        return threadId
      })
    }

    article.addEventListener('click', handleMarkClick)
    return () => article.removeEventListener('click', handleMarkClick)
  }, [state.status])

  // Deactivate when clicking anywhere outside a card or mark
  useEffect(() => {
    function handleDocumentClick() {
      setActiveThreadId(null)
    }
    document.addEventListener('click', handleDocumentClick)
    return () => document.removeEventListener('click', handleDocumentClick)
  }, [])

  // Sync .mark-active CSS class after active thread changes or marks are re-created
  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article) return
    article.querySelectorAll<HTMLElement>('mark[data-thread-id].mark-active').forEach((el) =>
      el.classList.remove('mark-active')
    )
    if (activeThreadId) {
      article
        .querySelector<HTMLElement>(`mark[data-thread-id="${activeThreadId}"]`)
        ?.classList.add('mark-active')
    }
  }, [activeThreadId, threads, contentVersion])

  // Recompute card positions when active card expands/collapses (height changes)
  useLayoutEffect(() => {
    computePositions()
  }, [activeThreadId, computePositions])

  useLayoutEffect(() => {
    computePositions()
  }, [selection, commentText, computePositions])

  // Clear reply + message-edit state when the active thread changes
  useEffect(() => {
    setReplyText('')
    setReplyError(null)
    setEditingMessageId(null)
    setMessageEditText('')
    setMessageEditError(null)
  }, [activeThreadId])

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
      setSelection((prev) => prev.kind === 'composing' ? { ...prev, saving: false, saveError: 'Network error while saving.' } : prev)
    }
  }

  function handleStartEdit(thread: Thread) {
    const rootMsg = thread.messages.find((m) => m.author === 'user')
    if (!rootMsg) return
    setEditingThreadId(thread.threadId)
    setEditText(rootMsg.body)
    setEditError(null)
  }

  function handleEditCancel() {
    setEditingThreadId(null)
    setEditText('')
    setEditError(null)
  }

  async function handleEditSave(threadId: string) {
    if (!editText.trim() || editSaving) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editText }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        setEditError(err.error)
        return
      }
      setEditingThreadId(null)
      setEditText('')
      loadThreads()
    } catch {
      setEditError('Network error while saving.')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(threadId: string) {
    if (!confirm('Delete this comment?')) return
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        alert(err.error)
        return
      }
      if (activeThreadId === threadId) setActiveThreadId(null)
      loadThreads()
    } catch {
      alert('Network error while deleting.')
    }
  }

  async function handleResolve(threadId: string) {
    try {
      const res = await fetch(`/api/threads/${threadId}/resolve`, { method: 'PATCH' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        alert(err.error)
        return
      }
      if (activeThreadId === threadId) setActiveThreadId(null)
      loadThreads()
    } catch {
      alert('Network error while resolving.')
    }
  }

  async function handleReply(threadId: string) {
    if (!replyText.trim() || replySaving) return
    setReplySaving(true)
    setReplyError(null)
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyText }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        setReplyError(err.error)
        return
      }
      setReplyText('')
      loadThreads()
    } catch {
      setReplyError('Network error while sending.')
    } finally {
      setReplySaving(false)
    }
  }

  function handleStartMessageEdit(msg: Message) {
    setEditingMessageId(msg.id)
    setMessageEditText(msg.body)
    setMessageEditError(null)
  }

  function handleMessageEditCancel() {
    setEditingMessageId(null)
    setMessageEditText('')
    setMessageEditError(null)
  }

  async function handleMessageEditSave(messageId: string) {
    if (!messageEditText.trim() || messageEditSaving) return
    setMessageEditSaving(true)
    setMessageEditError(null)
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: messageEditText }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        setMessageEditError(err.error)
        return
      }
      setEditingMessageId(null)
      setMessageEditText('')
      loadThreads()
    } catch {
      setMessageEditError('Network error while saving.')
    } finally {
      setMessageEditSaving(false)
    }
  }

  async function handleMessageDelete(messageId: string) {
    if (!confirm('Delete this reply?')) return
    try {
      const res = await fetch(`/api/messages/${messageId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
        alert(err.error)
        return
      }
      loadThreads()
    } catch {
      alert('Network error while deleting.')
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
      <button
        onClick={cycleTheme}
        title={theme === 'system' ? 'Theme: System' : theme === 'light' ? 'Theme: Light' : 'Theme: Dark'}
        style={styles.themeToggle}
      >
        {theme === 'light' ? <SunIcon /> : theme === 'dark' ? <MoonIcon /> : <SystemIcon />}
      </button>

      <article ref={articleRef} style={styles.document}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkLineData]}>
          {state.content}
        </ReactMarkdown>
      </article>

      <aside ref={asideRef} style={styles.sidebar} />

      {/* Existing thread cards */}
      {threads.map((thread) => {
        const top = cardPositions.get(thread.threadId) ?? 0
        const isActive = thread.threadId === activeThreadId
        const hasUnread = unreadThreadIds.has(thread.threadId)
        const isOrphaned = orphanedThreadIds.has(thread.threadId)

        function handleCardClick(e: React.MouseEvent) {
          e.stopPropagation()
          activateThread(thread.threadId)
          if (!isActive) {
            const mark = articleRef.current?.querySelector<HTMLElement>(
              `mark[data-thread-id="${thread.threadId}"]`
            )
            mark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }

        const hasAgentReply = thread.messages.some((m) => m.author === 'agent')
        const isEditing = editingThreadId === thread.threadId

        return (
          <div
            key={thread.threadId}
            ref={(el) => {
              if (el) cardEls.current.set(thread.threadId, el)
              else cardEls.current.delete(thread.threadId)
            }}
            onClick={handleCardClick}
            style={{
              ...styles.threadCard,
              ...(isOrphaned ? styles.threadCardOrphaned : {}),
              ...(isActive ? styles.threadCardActive : {}),
              top,
              left: asideOffsetLeft,
              visibility: cardPositions.size === 0 ? 'hidden' : 'visible',
            }}
          >
            <div style={styles.quotedTextRow}>
              <div style={styles.quotedText}>
                "{thread.selectedText.length > 80
                  ? thread.selectedText.slice(0, 80) + '…'
                  : thread.selectedText}"
              </div>
              {hasUnread && !isActive && (
                <div style={styles.newBadge}>
                  <span style={styles.newDot} />
                  New
                </div>
              )}
              {!isActive && !hasUnread && thread.messages.length > 1 && (
                <div style={styles.replyCountBadge}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {thread.messages.length - 1}
                </div>
              )}
              {isOrphaned && (
                <div style={styles.orphanBadge}>
                  Orphaned
                </div>
              )}
              {isActive && !isEditing && (
                <div style={styles.quoteIcons} onClick={(e) => e.stopPropagation()}>
                  <button
                    style={styles.iconBtn}
                    title="Resolve thread"
                    onClick={() => handleResolve(thread.threadId)}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  {!hasAgentReply && (
                    <>
                      <button
                        style={styles.iconBtn}
                        title="Edit comment"
                        onClick={() => handleStartEdit(thread)}
                      >
                        {/* pencil */}
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        style={{ ...styles.iconBtn, ...styles.iconBtnDanger }}
                        title="Delete comment"
                        onClick={() => handleDelete(thread.threadId)}
                      >
                        {/* trash */}
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={styles.messageList}>
              {isOrphaned && (
                <div style={styles.orphanHint}>
                  This quoted fragment is no longer present in the current document.
                </div>
              )}
              {thread.messages
                .filter((msg, i) => {
                  if (isEditing && i === 0 && msg.author === 'user') return false
                  // Only show replies when the card is active
                  const isRootMessage = msg.id === thread.messages[0]?.id
                  if (!isActive && !isRootMessage) return false
                  return true
                })
                .map((msg, i) => {
                  const isRootMessage = msg.id === thread.messages[0]?.id
                  const isEditingThisMessage = editingMessageId === msg.id
                  return (
                    <div
                      key={msg.id}
                      style={{
                        ...styles.message_,
                        ...(i > 0 && !isEditingThisMessage ? styles.messageSeparated : {}),
                      }}
                    >
                      {isEditingThisMessage ? (
                        <div style={styles.editArea} onClick={(e) => e.stopPropagation()}>
                          <textarea
                            style={styles.editTextarea}
                            value={messageEditText}
                            onChange={(e) => {
                              setMessageEditText(e.target.value)
                              e.target.style.height = 'auto'
                              e.target.style.height = e.target.scrollHeight + 'px'
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') handleMessageEditCancel()
                              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && messageEditText.trim()) handleMessageEditSave(msg.id)
                            }}
                            autoFocus
                            rows={2}
                          />
                          {messageEditError && <div style={styles.saveError}>{messageEditError}</div>}
                          <div style={styles.actions}>
                            <button style={styles.cancelBtn} onClick={handleMessageEditCancel} disabled={messageEditSaving}>
                              Cancel
                            </button>
                            <button
                              style={{
                                ...styles.saveBtn,
                                opacity: (messageEditText.trim() && !messageEditSaving) ? 1 : 0.5,
                                cursor: (messageEditText.trim() && !messageEditSaving) ? 'pointer' : 'default',
                              }}
                              onClick={() => handleMessageEditSave(msg.id)}
                              disabled={!messageEditText.trim() || messageEditSaving}
                            >
                              {messageEditSaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <div style={{
                              ...styles.avatar,
                              ...(msg.author === 'agent' ? styles.avatarAgent : styles.avatarUser)
                            }}>
                              {msg.author === 'agent' ? (
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
                                </svg>
                              ) : 'U'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, ...(msg.author === 'agent' ? styles.bubbleAgent : styles.bubbleUser) }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{
                                  ...styles.authorLabel,
                                  ...(msg.author === 'agent' ? styles.authorAgent : styles.authorUser),
                                }}>
                                  {msg.author === 'agent' ? 'Agent' : 'You'}
                                </span>
                                {isActive && !isRootMessage && msg.author === 'user' && (
                                  <div style={styles.quoteIcons} onClick={(e) => e.stopPropagation()}>
                                    <button
                                      style={styles.iconBtn}
                                      title="Edit reply"
                                      onClick={() => handleStartMessageEdit(msg)}
                                    >
                                      {/* pencil */}
                                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                      </svg>
                                    </button>
                                    <button
                                      style={{ ...styles.iconBtn, ...styles.iconBtnDanger }}
                                      title="Delete reply"
                                      onClick={() => handleMessageDelete(msg.id)}
                                    >
                                      {/* trash */}
                                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                        <path d="M10 11v6" />
                                        <path d="M14 11v6" />
                                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                              <p style={styles.messageBody}>{msg.body}</p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
            </div>

            {isActive && !isEditing && (
              <div style={styles.replyArea} onClick={(e) => e.stopPropagation()}>
                <textarea
                  style={styles.replyTextarea}
                  placeholder="Reply…"
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setReplyText('')
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyText.trim()) handleReply(thread.threadId)
                  }}
                  rows={1}
                />
                {replyError && <div style={{ ...styles.saveError, marginTop: '4px' }}>{replyError}</div>}
                {replyText.trim() && (
                  <div style={{ ...styles.actions, marginTop: '6px' }}>
                    <button
                      style={{ ...styles.cancelBtn, padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => setReplyText('')}
                      disabled={replySaving}
                    >
                      Cancel
                    </button>
                    <button
                      style={{
                        ...styles.saveBtn,
                        padding: '4px 12px',
                        fontSize: '12px',
                        opacity: !replySaving ? 1 : 0.5,
                        cursor: !replySaving ? 'pointer' : 'default',
                      }}
                      onClick={() => handleReply(thread.threadId)}
                      disabled={replySaving}
                    >
                      {replySaving ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {isActive && isEditing && (
              <div style={styles.editArea} onClick={(e) => e.stopPropagation()}>
                <textarea
                  style={styles.editTextarea}
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = e.target.scrollHeight + 'px'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleEditCancel()
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editText.trim()) handleEditSave(thread.threadId)
                  }}
                  autoFocus
                  rows={2}
                />
                {editError && <div style={styles.saveError}>{editError}</div>}
                <div style={styles.actions}>
                  <button style={styles.cancelBtn} onClick={handleEditCancel} disabled={editSaving}>
                    Cancel
                  </button>
                  <button
                    style={{
                      ...styles.saveBtn,
                      opacity: (editText.trim() && !editSaving) ? 1 : 0.5,
                      cursor: (editText.trim() && !editSaving) ? 'pointer' : 'default',
                    }}
                    onClick={() => handleEditSave(thread.threadId)}
                    disabled={!editText.trim() || editSaving}
                  >
                    {editSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {selection.kind === 'valid' && (
        <button
          title="Add comment"
          style={{
            ...styles.addCommentBtn,
            left: selection.buttonX,
            top: selection.buttonY,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddCommentClick}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          Comments must be within a single paragraph.
        </div>
      )}

      {selection.kind === 'composing' && (
        <div
          ref={composingCardRef}
          style={{
            ...styles.commentCard,
            top: selection.cardY,
            left: asideOffsetLeft,
          }}
        >
          <div style={{ ...styles.quotedText, marginBottom: '10px' }}>
            "{selection.selectedText.length > 80
              ? selection.selectedText.slice(0, 80) + '…'
              : selection.selectedText}"
          </div>

          <div style={styles.inputRow}>
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              placeholder="Add a comment…"
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
              Cancel
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
              {selection.saving ? 'Saving…' : 'Comment'}
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
    padding: '72px 56px',
    boxSizing: 'border-box' as const,
    gap: '48px',
    position: 'relative' as const,
  },
  document: {
    flex: '1 1 600px',
    minWidth: 0,
    fontFamily: 'Georgia, serif',
    fontSize: '22px',
    lineHeight: '1.8',
    color: 'var(--text)',
  },
  sidebar: {
    flex: '0 0 420px',
  },
  message: {
    padding: '72px 56px',
    color: 'var(--muted)',
    fontFamily: 'sans-serif',
  },
  threadCard: {
    position: 'absolute' as const,
    width: '420px',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '10px',
    boxShadow: '0 2px 8px var(--card-shadow)',
    padding: '20px',
    zIndex: 50,
    fontFamily: 'Roboto, Arial, sans-serif',
    transition: 'top 0.15s ease',
    cursor: 'pointer',
  },
  threadCardOrphaned: {
    borderStyle: 'dashed' as const,
    opacity: '0.92',
  },
  threadCardActive: {
    zIndex: 60,
    cursor: 'default',
  },
  messageList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0',
  },
  message_: {
    paddingTop: '6px',
  },
  messageSeparated: {
    borderTop: '1px solid var(--card-border)',
    paddingTop: '12px',
    marginTop: '12px',
  },
  avatar: {
    width: '30px',
    height: '30px',
    borderRadius: '15px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    flexShrink: 0,
    marginTop: '2px',
    userSelect: 'none' as const,
  },
  avatarUser: {
    backgroundColor: 'var(--accent)',
    color: '#fff',
  },
  avatarAgent: {
    backgroundColor: 'var(--agent-accent)',
    color: '#fff',
  },
  bubbleUser: {
    backgroundColor: 'transparent',
    padding: '0',
    borderRadius: '0',
  },
  bubbleAgent: {
    backgroundColor: 'var(--agent-bg)',
    padding: '10px 12px',
    borderRadius: '4px 8px 8px 4px',
    borderLeft: '3px solid var(--agent-accent)',
    marginTop: '-4px', // offset default padding
  },
  authorLabel: {
    display: 'inline-block',
    fontSize: '13px',
    fontWeight: '700' as const,
    letterSpacing: '0.02em',
    marginBottom: '3px',
    textTransform: 'uppercase' as const,
  },
  authorUser: {
    color: 'var(--accent)',
  },
  authorAgent: {
    color: 'var(--agent-accent)',
  },
  messageBody: {
    margin: '0',
    fontSize: '16px',
    lineHeight: '1.6',
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
    fontSize: '14px',
    fontFamily: 'sans-serif',
    fontWeight: '600' as const,
    padding: '6px 9px',
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
    fontSize: '15px',
    padding: '8px 16px',
    borderRadius: '6px',
    whiteSpace: 'nowrap' as const,
    pointerEvents: 'none' as const,
    zIndex: 100,
    boxShadow: '0 2px 8px var(--card-shadow)',
  },
  commentCard: {
    position: 'absolute' as const,
    width: '420px',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '10px',
    boxShadow: '0 4px 16px var(--card-shadow)',
    padding: '20px',
    zIndex: 200,
    fontFamily: 'Roboto, Arial, sans-serif',
  },
  quotedText: {
    flex: 1,
    minWidth: 0,
    wordBreak: 'break-word' as const,
    fontSize: '15px',
    color: 'var(--muted)',
    fontStyle: 'italic' as const,
    borderLeft: '3px solid var(--quote-border)',
    paddingLeft: '10px',
    lineHeight: '1.5',
  },
  orphanBadge: {
    flexShrink: 0,
    marginLeft: '8px',
    padding: '3px 8px',
    borderRadius: '999px',
    background: 'var(--agent-bg)',
    color: 'var(--agent-accent)',
    fontSize: '12px',
    fontWeight: '700' as const,
    letterSpacing: '0.03em',
    textTransform: 'uppercase' as const,
  },
  orphanHint: {
    marginBottom: '10px',
    padding: '10px 12px',
    borderRadius: '6px',
    background: 'rgba(179, 110, 0, 0.08)',
    color: '#8a5a00',
    fontSize: '14px',
    lineHeight: '1.45',
  },
  inputRow: {
    marginBottom: '10px',
  },
  textarea: {
    width: '100%',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '15px',
    lineHeight: '1.5',
    color: 'var(--text)',
    background: 'transparent',
    padding: '4px 0',
    borderBottom: '2px solid var(--accent)',
    overflow: 'hidden',
  },
  saveError: {
    fontSize: '14px',
    color: '#cc2222',
    marginBottom: '8px',
    lineHeight: '1.4',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '6px',
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    fontSize: '15px',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeight: '500' as const,
    padding: '8px 16px',
    borderRadius: '4px',
    userSelect: 'none' as const,
  },
  saveBtn: {
    background: 'var(--accent)',
    color: 'var(--accent-btn-text, #fff)',
    border: 'none',
    fontSize: '15px',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontWeight: '500' as const,
    padding: '8px 20px',
    borderRadius: '4px',
    userSelect: 'none' as const,
  },
  quotedTextRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '14px',
  },
  quoteIcons: {
    display: 'flex',
    flexShrink: 0,
    gap: '4px',
    marginTop: '1px',
  },
  newBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
    marginTop: '1px',
    padding: '3px 10px',
    borderRadius: '999px',
    background: 'rgba(34, 102, 221, 0.1)',
    color: 'var(--accent)',
    fontSize: '13px',
    fontWeight: '700' as const,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },
  newDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--accent)',
    boxShadow: '0 0 0 3px rgba(34, 102, 221, 0.14)',
  },
  replyCountBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    flexShrink: 0,
    marginTop: '1px',
    padding: '3px 9px',
    borderRadius: '999px',
    background: 'rgba(0,0,0,0.05)',
    color: 'var(--muted)',
    fontSize: '13px',
    fontWeight: '600' as const,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    padding: '4px',
    borderRadius: '3px',
    lineHeight: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDanger: {
    color: '#cc2222',
  },
  replyArea: {
    marginTop: '14px',
  },
  replyTextarea: {
    width: '100%',
    border: '1px solid var(--card-border)',
    borderRadius: '24px',
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '15px',
    lineHeight: '1.5',
    color: 'var(--text)',
    background: 'transparent',
    padding: '9px 18px',
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
    display: 'block',
  },
  editArea: {
    marginTop: '12px',
    paddingTop: '10px',
    borderTop: '1px solid var(--card-border)',
  },
  editTextarea: {
    width: '100%',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '15px',
    lineHeight: '1.5',
    color: 'var(--text)',
    background: 'transparent',
    padding: '4px 0',
    borderBottom: '2px solid var(--accent)',
    overflow: 'hidden',
  },
  themeToggle: {
    position: 'fixed' as const,
    top: '20px',
    right: '24px',
    zIndex: 500,
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
    color: 'var(--muted)',
    lineHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px var(--card-shadow)',
  },
} as const
