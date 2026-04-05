import { defineCommand } from 'citty'
import { db } from '../../db.js'

export default defineCommand({
  meta: { description: 'Mark a thread as resolved' },
  args: {
    threadId: { type: 'positional', description: 'Thread ID', required: true },
  },
  run({ args }) {
    const threadId = args.threadId

    const thread = db
      .prepare<[string], { id: string; status: string }>('SELECT id, status FROM threads WHERE id = ?')
      .get(threadId)

    if (!thread) {
      console.error(`Error: thread not found: ${threadId}`)
      process.exit(1)
    }

    if (thread.status === 'resolved') {
      console.log(JSON.stringify({ threadId, status: 'resolved' }))
      return
    }

    db.prepare("UPDATE threads SET status = 'resolved' WHERE id = ?").run(threadId)

    console.log(JSON.stringify({ threadId, status: 'resolved' }))
  },
})
