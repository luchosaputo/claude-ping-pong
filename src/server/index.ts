import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { join } from 'path'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.use('/*', serveStatic({ root: './dist/client' }))

app.get('*', (c) => {
  const html = readFileSync(join(process.cwd(), 'dist/client/index.html'), 'utf-8')
  return c.html(html)
})

const port = Number(process.env.CLAUDE_REVIEW_PORT ?? 3737)

serve({ fetch: app.fetch, port }, () => {
  console.log(`claude-ping-pong server running on http://localhost:${port}`)
})
