import { PORT } from '../config.js'

type ThreadUpdateType = 'reply' | 'resolve'

export async function notifyThreadUpdated(fileId: string, threadId: string, type: ThreadUpdateType): Promise<void> {
  try {
    await fetch(`http://localhost:${PORT}/api/events/${fileId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'thread:updated', threadId, type }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // The CLI writes directly to SQLite; SSE notification is best-effort only.
  }
}
