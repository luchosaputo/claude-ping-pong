import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = Number(process.env.CLAUDE_REVIEW_PORT ?? 3737)

serve({ fetch: app.fetch, port }, () => {
  console.log(`claude-ping-pong server running on http://localhost:${port}`)
})
