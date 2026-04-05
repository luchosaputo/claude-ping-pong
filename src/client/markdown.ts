import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

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
