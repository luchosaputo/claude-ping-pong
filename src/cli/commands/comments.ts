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
      WITH latest_messages AS (
        SELECT
          t.id AS thread_id,
          (
            SELECT m_last.id
            FROM messages m_last
            WHERE m_last.thread_id = t.id
            ORDER BY m_last.created_at DESC, m_last.id DESC
            LIMIT 1
          ) AS latest_message_id
        FROM threads t
        WHERE t.file_id = ?
          AND t.status = 'open'
      )
      SELECT
        t.id,
        t.selected_text,
        t.line_range_start,
        t.line_range_end,
        m.id AS message_id,
        m.author,
        m.body,
        m.created_at,
        latest.id AS latest_message_id
      FROM latest_messages lm
      JOIN threads t ON t.id = lm.thread_id
      JOIN messages latest ON latest.id = lm.latest_message_id
      JOIN messages m ON m.thread_id = t.id
      WHERE latest.author = 'user'
        AND latest.acknowledged = 0
      ORDER BY t.created_at ASC, m.created_at ASC, m.id ASC
    `).all(fileId) as Array<{
      id: string
      selected_text: string
      line_range_start: number
      line_range_end: number
      message_id: string
      author: string
      body: string
      created_at: number
      latest_message_id: string
    }>

    const threadsMap = new Map<string, {
      threadId: string
      fragment: string
      lineRange: {
        start: number
        end: number
      }
      context: Array<{
        id: string
        author: string
        body: string
        createdAt: number
      }>
      latestMessage: {
        id: string
        author: string
        body: string
        createdAt: number
      } | null
    }>()
    const messageIdsToAck = new Set<string>()

    for (const row of rows) {
      if (!threadsMap.has(row.id)) {
        threadsMap.set(row.id, {
          threadId: row.id,
          fragment: row.selected_text,
          lineRange: {
            start: row.line_range_start,
            end: row.line_range_end,
          },
          context: [],
          latestMessage: null,
        })
      }

      const message = {
        id: row.message_id,
        author: row.author,
        body: row.body,
        createdAt: row.created_at,
      }

      const thread = threadsMap.get(row.id)!
      if (row.message_id === row.latest_message_id) {
        thread.latestMessage = message
        messageIdsToAck.add(row.message_id)
      } else {
        thread.context.push(message)
      }
    }

    if (messageIdsToAck.size > 0) {
      const ids = Array.from(messageIdsToAck)
      const updateStmt = db.prepare(`UPDATE messages SET acknowledged = 1 WHERE id = ?`)
      db.transaction(() => {
        for (const id of ids) {
          updateStmt.run(id)
        }
      })()
    }

    const payload = Array.from(threadsMap.values())
      .filter((thread) => thread.latestMessage !== null)
      .map((thread) => {
        const formatted: {
          threadId: string
          fragment: string
          lineRange: { start: number; end: number }
          messages: Array<{ id: string; author: string; body: string; createdAt: number }>
          context?: Array<{ id: string; author: string; body: string; createdAt: number }>
        } = {
          threadId: thread.threadId,
          fragment: thread.fragment,
          lineRange: thread.lineRange,
          messages: [thread.latestMessage!],
        }
        if (thread.context.length > 0) {
          formatted.context = thread.context
        }
        return formatted
      })

    console.log(JSON.stringify(payload, null, 2))
  }
})
