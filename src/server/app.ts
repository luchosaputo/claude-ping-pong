import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PORT, DATA_DIR } from '../config.js'
import { db } from '../db.js'
export const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.get('/api/files/:fileId/content', (c) => {
  const { fileId } = c.req.param()
  const row = db.prepare<[string], { path: string }>('SELECT path FROM files WHERE id = ?').get(fileId)
  if (!row) return c.json({ error: 'File not found' }, 404)
  if (!existsSync(row.path)) return c.json({ error: 'File no longer exists on disk' }, 404)
  return c.text(readFileSync(row.path, 'utf-8'))
})


app.use('/*', serveStatic({ root: './dist/client' }))

app.get('*', (c) => {
  const html = readFileSync(join(process.cwd(), 'dist/client/index.html'), 'utf-8')
  return c.html(html)
})
