import { resolve } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { defineCommand } from 'citty'
import { nanoid } from 'nanoid'
import { db } from '../../db.js'
import { PORT } from '../../config.js'

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

async function waitForServer(maxWaitMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (await checkHealth()) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Server did not start within ${maxWaitMs}ms`)
}

function spawnServer(): void {
  const serverPath = fileURLToPath(new URL('../../server/index.js', import.meta.url))
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
}

async function ensureServer(): Promise<void> {
  if (await checkHealth()) return
  spawnServer()
  await waitForServer()
}

async function enableFileWatch(fileId: string): Promise<void> {
  const res = await fetch(`http://localhost:${PORT}/api/files/${fileId}/watch`, {
    method: 'POST',
    signal: AbortSignal.timeout(2000),
  })

  if (!res.ok) {
    throw new Error(`Failed to start file watcher for ${fileId}`)
  }
}

export default defineCommand({
  meta: { description: 'Register a Markdown file and open it in the viewer' },
  args: {
    file: { type: 'positional', description: 'Path to the Markdown file', required: true },
  },
  async run({ args }) {
    const absPath = resolve(args.file)

    if (!/\.mdx?$/i.test(absPath)) {
      console.error(`Error: only Markdown files (.md, .mdx) are supported`)
      process.exit(1)
    }

    if (!existsSync(absPath)) {
      console.error(`Error: file not found: ${absPath}`)
      process.exit(1)
    }

    await ensureServer()

    const existing = db
      .prepare<[string], { id: string }>('SELECT id FROM files WHERE path = ?')
      .get(absPath)

    let fileId: string
    if (existing) {
      fileId = existing.id
    } else {
      fileId = nanoid()
      db.prepare('INSERT INTO files (id, path, registered_at) VALUES (?, ?, ?)').run(
        fileId,
        absPath,
        Date.now(),
      )
    }

    await enableFileWatch(fileId)

    console.log(JSON.stringify({ fileId, url: `http://localhost:${PORT}/view/${fileId}` }))
  },
})
