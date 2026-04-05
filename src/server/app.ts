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

interface RawThreadRow {
  id: string
  selected_text: string
  prefix_context: string | null
  suffix_context: string | null
  line_range_start: number
  line_range_end: number
  thread_created_at: number
  message_id: string
  author: string
  body: string
  message_created_at: number
}

app.get('/api/files/:fileId/threads', (c) => {
  const { fileId } = c.req.param()
  const file = db.prepare<[string], { id: string }>('SELECT id FROM files WHERE id = ?').get(fileId)
  if (!file) return c.json({ error: 'File not found' }, 404)

  const rows = db.prepare<[string], RawThreadRow>(`
    SELECT t.id, t.selected_text, t.prefix_context, t.suffix_context,
           t.line_range_start, t.line_range_end, t.created_at AS thread_created_at,
           m.id AS message_id, m.author, m.body, m.created_at AS message_created_at
    FROM threads t
    JOIN messages m ON m.thread_id = t.id
    WHERE t.file_id = ? AND t.status = 'open'
    ORDER BY t.created_at ASC, m.created_at ASC
  `).all(fileId)

  const map = new Map<string, {
    threadId: string
    selectedText: string
    prefixContext: string | null
    suffixContext: string | null
    lineRangeStart: number
    lineRangeEnd: number
    createdAt: number
    messages: Array<{ id: string; author: string; body: string; createdAt: number }>
  }>()

  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        threadId: row.id,
        selectedText: row.selected_text,
        prefixContext: row.prefix_context,
        suffixContext: row.suffix_context,
        lineRangeStart: row.line_range_start,
        lineRangeEnd: row.line_range_end,
        createdAt: row.thread_created_at,
        messages: [],
      })
    }
    map.get(row.id)!.messages.push({
      id: row.message_id,
      author: row.author,
      body: row.body,
      createdAt: row.message_created_at,
    })
  }

  return c.json([...map.values()])
})

app.patch('/api/threads/:threadId', async (c) => {
  const { threadId } = c.req.param()

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { body: newBody } = body as Record<string, unknown>
  if (!newBody || typeof newBody !== 'string' || !newBody.trim()) {
    return c.json({ error: 'body is required' }, 400)
  }

  const thread = db.prepare<[string], { id: string }>('SELECT id FROM threads WHERE id = ?').get(threadId)
  if (!thread) return c.json({ error: 'Thread not found' }, 404)

  const agentMsg = db.prepare<[string], { id: string }>(
    "SELECT id FROM messages WHERE thread_id = ? AND author = 'agent' LIMIT 1"
  ).get(threadId)
  if (agentMsg) return c.json({ error: 'Cannot edit a thread that has agent replies' }, 409)

  // Update the root (first) user message
  db.prepare(
    "UPDATE messages SET body = ? WHERE thread_id = ? AND author = 'user' ORDER BY created_at ASC LIMIT 1"
  ).run(newBody.trim(), threadId)

  return c.json({ ok: true })
})

app.delete('/api/threads/:threadId', (c) => {
  const { threadId } = c.req.param()

  const thread = db.prepare<[string], { id: string }>('SELECT id FROM threads WHERE id = ?').get(threadId)
  if (!thread) return c.json({ error: 'Thread not found' }, 404)

  const agentMsg = db.prepare<[string], { id: string }>(
    "SELECT id FROM messages WHERE thread_id = ? AND author = 'agent' LIMIT 1"
  ).get(threadId)
  if (agentMsg) return c.json({ error: 'Cannot delete a thread that has agent replies' }, 409)

  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId)
    db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
  })()

  return c.json({ ok: true })
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
