import { serve } from '@hono/node-server'
import { PORT, DATA_DIR } from '../config.js'
import { app } from './app.js'

function patchStream(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream)
  ;(stream as any).write = (chunk: any, ...args: any[]) => {
    const ts = new Date().toISOString()
    const str = typeof chunk === 'string' ? chunk : chunk.toString()
    return original(`[${ts}] ${str}`, ...args)
  }
}

patchStream(process.stdout)
patchStream(process.stderr)

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`claude-ping-pong server running on http://localhost:${PORT}`)
  console.log(`data dir: ${DATA_DIR}`)
})
