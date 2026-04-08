import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

// ── Minimal HAST types (hast is a transitive dep; define what we need inline) ──

interface HastText { type: 'text'; value: string }
interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastChild[]
}
type HastChild = HastText | HastElement | { type: string }
interface HastRoot { type: 'root'; children: HastChild[] }

// ── remarkLineData ────────────────────────────────────────────────────────────

const BLOCK_TYPES = new Set([
  'heading',
  'paragraph',
  'code',
  'blockquote',
  'list',
  'thematicBreak',
  'table',
])

export function remarkLineData() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type) || !node.position) return
      node.data ??= {}
      node.data.hProperties = {
        ...(node.data.hProperties as object | undefined),
        'data-line-start': node.position.start.line,
        'data-line-end': node.position.end.line,
      }
    })
  }
}

// ── rehypeMarks ───────────────────────────────────────────────────────────────

export interface ThreadMark {
  threadId: string
  selectedText: string
  prefixContext: string | null
  suffixContext: string | null
  lineRangeStart: number
  lineRangeEnd: number
}

export interface MarksOptions {
  threads: ThreadMark[]
}

/** Concatenate all descendant text node values. */
function hastText(node: HastChild): string {
  if (node.type === 'text') return (node as HastText).value
  if (node.type === 'element') {
    return (node as HastElement).children.reduce((acc, c) => acc + hastText(c), '')
  }
  return ''
}

/** Find character offset of selectedText in fullText using prefix/suffix context, then fallbacks. */
function matchOffset(
  fullText: string,
  selectedText: string,
  prefixContext: string | null,
  suffixContext: string | null,
): number {
  if (prefixContext !== null && suffixContext !== null) {
    const needle = prefixContext + selectedText + suffixContext
    const idx = fullText.indexOf(needle)
    if (idx !== -1) return idx + prefixContext.length
  }
  const idx = fullText.indexOf(selectedText)
  if (idx !== -1) return idx
  const normFull = fullText.replace(/\s+/g, ' ')
  const normSel = selectedText.replace(/\s+/g, ' ').trim()
  if (normSel.length > 0) {
    const normIdx = normFull.indexOf(normSel)
    if (normIdx !== -1) return normIdx
  }
  return -1
}

/**
 * Recursively split HAST children, wrapping the character range [markStart, markEnd)
 * in a <mark data-thread-id="…"> element.
 * pos.v tracks the running character offset through the tree.
 */
function applyMark(
  children: HastChild[],
  markStart: number,
  markEnd: number,
  threadId: string,
  pos: { v: number },
): HastChild[] {
  const out: HastChild[] = []
  for (const child of children) {
    if (child.type === 'text') {
      const t = child as HastText
      const s = pos.v
      const e = s + t.value.length
      pos.v = e

      const os = Math.max(markStart, s) - s
      const oe = Math.min(markEnd, e) - s

      if (os >= oe) { out.push(t); continue }

      if (os > 0) out.push({ type: 'text', value: t.value.slice(0, os) } as HastText)
      out.push({
        type: 'element',
        tagName: 'mark',
        properties: { 'data-thread-id': threadId },
        children: [{ type: 'text', value: t.value.slice(os, oe) } as HastText],
      } as HastElement)
      if (oe < t.value.length) out.push({ type: 'text', value: t.value.slice(oe) } as HastText)
    } else if (child.type === 'element') {
      const el = child as HastElement
      out.push({ ...el, children: applyMark(el.children, markStart, markEnd, threadId, pos) })
    } else {
      out.push(child)
    }
  }
  return out
}

/**
 * rehype plugin: wraps each thread's selected text in <mark data-thread-id="…">.
 * Mirrors the block-candidate prioritisation of the previous DOM-based anchoring:
 *   1. Block whose lineStart exactly matches thread.lineRangeStart
 *   2. Block whose range contains the thread's range
 *   3. Any block (fallback)
 */
export function rehypeMarks({ threads }: MarksOptions) {
  return (tree: HastRoot) => {
    if (threads.length === 0) return

    // Collect all annotated block elements in document order
    const blocks: HastElement[] = []
    visit(tree as unknown as Root, 'element', (node) => {
      const el = node as unknown as HastElement
      if (el.properties?.['data-line-start'] !== undefined) blocks.push(el)
    })
    if (blocks.length === 0) return

    type Pending = { block: HastElement; thread: ThreadMark; offset: number; end: number }
    const pending: Pending[] = []
    const placed = new Set<string>()

    function tryPlace(thread: ThreadMark, filter: (b: HastElement) => boolean): boolean {
      if (placed.has(thread.threadId)) return true
      for (const block of blocks) {
        if (!filter(block)) continue
        const fullText = hastText(block)
        const offset = matchOffset(fullText, thread.selectedText, thread.prefixContext, thread.suffixContext)
        if (offset === -1) continue
        pending.push({ block, thread, offset, end: offset + thread.selectedText.length })
        placed.add(thread.threadId)
        return true
      }
      return false
    }

    for (const thread of threads) {
      const ls = thread.lineRangeStart
      const le = thread.lineRangeEnd
      tryPlace(thread, b => Number(b.properties['data-line-start']) === ls) ||
      tryPlace(thread, b => {
        const bs = Number(b.properties['data-line-start'])
        const be = Number(b.properties['data-line-end'] ?? bs)
        return bs <= ls && be >= le
      }) ||
      tryPlace(thread, () => true)
    }

    // Group by block, sort each group by offset, then apply left-to-right
    const byBlock = new Map<HastElement, Pending[]>()
    for (const p of pending) {
      const arr = byBlock.get(p.block) ?? []
      arr.push(p)
      byBlock.set(p.block, arr)
    }

    for (const [block, marks] of byBlock) {
      marks.sort((a, b) => a.offset - b.offset)
      let children = block.children
      for (const { thread, offset, end } of marks) {
        children = applyMark(children, offset, end, thread.threadId, { v: 0 })
      }
      block.children = children
    }
  }
}
