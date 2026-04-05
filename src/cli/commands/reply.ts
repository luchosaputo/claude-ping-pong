import { defineCommand } from 'citty'
import { nanoid } from 'nanoid'
import { db } from '../../db.js'

export default defineCommand({
  meta: { description: 'Insert an agent reply into an open thread' },
  args: {
    threadId: { type: 'positional', description: 'Thread ID', required: true },
    body: { type: 'positional', description: 'Reply text', required: true },
  },
  run({ args }) {
    const threadId = args.threadId
    const body = args.body.trim()

    if (!body) {
      console.error('Error: reply body cannot be empty')
      process.exit(1)
    }

    const thread = db
      .prepare<[string], { id: string; status: string }>('SELECT id, status FROM threads WHERE id = ?')
      .get(threadId)

    if (!thread) {
      console.error(`Error: thread not found: ${threadId}`)
      process.exit(1)
    }

    if (thread.status === 'resolved') {
      console.error(`Error: cannot reply to resolved thread: ${threadId}`)
      process.exit(1)
    }

    const messageId = nanoid()
    db.prepare(
      "INSERT INTO messages (id, thread_id, author, body, created_at) VALUES (?, ?, 'agent', ?, ?)",
    ).run(messageId, threadId, body, Date.now())

    console.log(JSON.stringify({ threadId, messageId }))
  },
})
