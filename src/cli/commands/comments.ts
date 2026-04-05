import { defineCommand } from 'citty'
import { db } from '../../db.js'

export default defineCommand({
  meta: { description: 'Get unacknowledged, open comments for a file without agent replies' },
  args: {
    fileId: { type: 'positional', description: 'ID of the registered file', required: true },
  },
  run({ args }) {
    const fileId = args.fileId

    const rows = db.prepare(`
      SELECT t.id, t.selected_text, t.line_range_start, t.line_range_end,
             m.author, m.body, m.created_at
      FROM threads t
      JOIN messages m ON m.thread_id = t.id
      WHERE t.file_id = ? 
        AND t.status = 'open' 
        AND t.acknowledged = 0
        AND (
          SELECT m2.author FROM messages m2 WHERE m2.thread_id = t.id ORDER BY m2.created_at DESC LIMIT 1
        ) = 'user'
      ORDER BY t.created_at ASC, m.created_at ASC
    `).all(fileId) as Array<{
      id: string
      selected_text: string
      line_range_start: number
      line_range_end: number
      author: string
      body: string
      created_at: number
    }>

    const threadsMap = new Map<string, any>()
    const threadIdsToAck = new Set<string>()

    for (const row of rows) {
      if (!threadsMap.has(row.id)) {
        threadsMap.set(row.id, {
          threadId: row.id,
          fragment: row.selected_text,
          lineRange: {
            start: row.line_range_start,
            end: row.line_range_end,
          },
          messages: []
        })
        threadIdsToAck.add(row.id)
      }
      threadsMap.get(row.id).messages.push({
        author: row.author,
        body: row.body,
        createdAt: row.created_at
      })
    }

    if (threadIdsToAck.size > 0) {
      const ids = Array.from(threadIdsToAck)
      const updateStmt = db.prepare(`UPDATE threads SET acknowledged = 1 WHERE id = ?`)
      db.transaction(() => {
        for (const id of ids) {
          updateStmt.run(id)
        }
      })()
    }

    const payload = Array.from(threadsMap.values()).map(t => {
      const msgs = t.messages
      const lastMsg = msgs.pop()
      const formatted: any = {
        threadId: t.threadId,
        fragment: t.fragment,
        lineRange: t.lineRange,
        messages: [lastMsg] // Only the last message goes here
      }
      if (msgs.length > 0) {
        formatted.context = msgs // All preceding messages
      }
      return formatted
    })

    console.log(JSON.stringify(payload, null, 2))
  }
})
