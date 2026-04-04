import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PORT, DATA_DIR, ensureDataDir } from '../config.js'

ensureDataDir()

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.use('/*', serveStatic({ root: './dist/client' }))

app.get('*', (c) => {
  const html = readFileSync(join(process.cwd(), 'dist/client/index.html'), 'utf-8')
  return c.html(html)
})

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`claude-ping-pong server running on http://localhost:${PORT}`)
  console.log(`data dir: ${DATA_DIR}`)
})
