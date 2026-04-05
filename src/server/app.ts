import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'
import { PORT, DATA_DIR } from '../config.js'
import { db } from '../db.js'
export const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.post('/api/threads', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { fileId, selectedText, body: commentBody, prefixContext, suffixContext, lineRangeStart, lineRangeEnd } = body as Record<string, unknown>

  if (!fileId || typeof fileId !== 'string') return c.json({ error: 'fileId is required' }, 400)
  if (!selectedText || typeof selectedText !== 'string') return c.json({ error: 'selectedText is required' }, 400)
  if (!commentBody || typeof commentBody !== 'string') return c.json({ error: 'body is required' }, 400)

  const file = db.prepare<[string], { id: string }>('SELECT id FROM files WHERE id = ?').get(fileId)
  if (!file) return c.json({ error: 'File not found' }, 404)

  const threadId = nanoid()
  const messageId = nanoid()
  const now = Date.now()

  db.transaction(() => {
    db.prepare(
      'INSERT INTO threads (id, file_id, selected_text, prefix_context, suffix_context, line_range_start, line_range_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(threadId, fileId, selectedText, prefixContext ?? null, suffixContext ?? null, lineRangeStart ?? null, lineRangeEnd ?? null, now)

    db.prepare(
      'INSERT INTO messages (id, thread_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(messageId, threadId, 'user', commentBody, now)
  })()

  return c.json({ threadId, messageId }, 201)
})

app.get('/api/files/:fileId/content', (c) => {
  const { fileId } = c.req.param()
  const row = db.prepare<[string], { path: string }>('SELECT path FROM files WHERE id = ?').get(fileId)
  if (!row) return c.json({ error: 'File not found' }, 404)
  if (!existsSync(row.path)) return c.json({ error: 'File no longer exists on disk' }, 404)
  return c.text(readFileSync(row.path, 'utf-8'))
})


if (process.env.NODE_ENV !== 'development') {
  app.use('/*', serveStatic({ root: './dist/client' }))

  app.get('*', (c) => {
    const html = readFileSync(join(process.cwd(), 'dist/client/index.html'), 'utf-8')
    return c.html(html)
  })
}
