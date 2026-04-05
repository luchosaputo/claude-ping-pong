import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from 'citty'

const { allMock, runMock, transactionMock } = vi.hoisted(() => ({
  allMock: vi.fn(),
  runMock: vi.fn(),
  transactionMock: vi.fn().mockImplementation((fn: () => void) => () => fn()),
}))

vi.mock('../../../db.js', () => ({
  db: {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('WITH latest_messages')) {
        return { all: allMock }
      }
      if (sql.includes('UPDATE messages SET acknowledged = 1')) {
        return { run: runMock }
      }
      throw new Error(`Unexpected SQL in test: ${sql}`)
    }),
    transaction: transactionMock,
  },
}))

import commentsCmd from '../comments.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('comments command', () => {
  it('returns only the latest unacknowledged user message and moves earlier history to context', async () => {
    allMock.mockReturnValue([
      {
        id: 'thread-1',
        selected_text: 'fragment',
        line_range_start: 10,
        line_range_end: 12,
        message_id: 'm1',
        author: 'user',
        body: 'original comment',
        created_at: 100,
        latest_message_id: 'm3',
      },
      {
        id: 'thread-1',
        selected_text: 'fragment',
        line_range_start: 10,
        line_range_end: 12,
        message_id: 'm2',
        author: 'agent',
        body: 'agent reply',
        created_at: 200,
        latest_message_id: 'm3',
      },
      {
        id: 'thread-1',
        selected_text: 'fragment',
        line_range_start: 10,
        line_range_end: 12,
        message_id: 'm3',
        author: 'user',
        body: 'follow-up',
        created_at: 300,
        latest_message_id: 'm3',
      },
    ])

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand(commentsCmd, { rawArgs: ['file-1'] })

    const payload = JSON.parse(consoleSpy.mock.calls[0][0] as string) as Array<{
      threadId: string
      fragment: string
      lineRange: { start: number; end: number }
      messages: Array<{ id: string; author: string; body: string; createdAt: number }>
      context?: Array<{ id: string; author: string; body: string; createdAt: number }>
    }>

    expect(payload).toEqual([
      {
        threadId: 'thread-1',
        fragment: 'fragment',
        lineRange: { start: 10, end: 12 },
        context: [
          { id: 'm1', author: 'user', body: 'original comment', createdAt: 100 },
          { id: 'm2', author: 'agent', body: 'agent reply', createdAt: 200 },
        ],
        messages: [
          { id: 'm3', author: 'user', body: 'follow-up', createdAt: 300 },
        ],
      },
    ])
    expect(runMock).toHaveBeenCalledOnce()
    expect(runMock).toHaveBeenCalledWith('m3')
  })

  it('prints an empty array when there are no pending user messages', async () => {
    allMock.mockReturnValue([])
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand(commentsCmd, { rawArgs: ['file-1'] })

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual([])
    expect(runMock).not.toHaveBeenCalled()
  })
})
