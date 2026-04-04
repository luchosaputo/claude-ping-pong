import { serve } from '@hono/node-server'
import { PORT, DATA_DIR } from '../config.js'
import { app } from './app.js'

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`claude-ping-pong server running on http://localhost:${PORT}`)
  console.log(`data dir: ${DATA_DIR}`)
})
