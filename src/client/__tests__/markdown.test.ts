import { describe, it, expect } from 'vitest'
import { remark } from 'remark'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkLineData } from '../markdown.js'

async function toHtml(source: string): Promise<string> {
  const file = await remark()
    .use(remarkLineData)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(source)
  return String(file)
}

describe('remarkLineData', () => {
  it('adds data-line-start and data-line-end to a heading', async () => {
    const html = await toHtml('# Hello World\n')
    expect(html).toContain('data-line-start="1"')
    expect(html).toContain('data-line-end="1"')
    expect(html).toContain('<h1')
  })

  it('adds data-line-start and data-line-end to a paragraph', async () => {
    const html = await toHtml('Some paragraph text.\n')
    expect(html).toContain('data-line-start="1"')
    expect(html).toContain('<p')
  })

  it('tracks line numbers correctly across multiple blocks', async () => {
    const html = await toHtml('# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
    expect(html).toContain('<h1 data-line-start="1"')
    expect(html).toContain('<p data-line-start="3"')
    expect(html).toContain('<p data-line-start="5"')
  })

  it('adds data-line-start and data-line-end to a fenced code block', async () => {
    const html = await toHtml('Text before.\n\n```js\nconst x = 1\n```\n')
    // remark's `code` node maps to <code> in hast; rehype wraps it in <pre>
    expect(html).toContain('<code class="language-js" data-line-start="3"')
  })

  it('adds data-line-start and data-line-end to a list', async () => {
    const html = await toHtml('- item one\n- item two\n- item three\n')
    expect(html).toContain('<ul data-line-start="1"')
  })

  it('adds data-line-start and data-line-end to a blockquote', async () => {
    const html = await toHtml('> This is a quote.\n')
    expect(html).toContain('<blockquote data-line-start="1"')
  })

  it('adds data-line-start and data-line-end to a thematic break', async () => {
    const html = await toHtml('Before\n\n---\n\nAfter\n')
    expect(html).toContain('<hr data-line-start="3"')
  })

  it('does not add attributes to inline elements', async () => {
    const html = await toHtml('Text with **bold** and _italic_.\n')
    expect(html).not.toContain('<strong data-line')
    expect(html).not.toContain('<em data-line')
  })
})
