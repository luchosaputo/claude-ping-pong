import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from 'citty'

const { getMock, runMock, notifyThreadUpdatedMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  notifyThreadUpdatedMock: vi.fn(),
}))

vi.mock('../../../db.js', () => ({
  db: {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, status, file_id FROM threads')) {
        return { get: getMock }
      }
      if (sql.includes("INSERT INTO messages")) {
        return { run: runMock }
      }
      throw new Error(`Unexpected SQL in test: ${sql}`)
    }),
  },
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn().mockReturnValue('msg-agent'),
}))

vi.mock('../../notify.js', () => ({
  notifyThreadUpdated: notifyThreadUpdatedMock,
}))

import replyCmd from '../reply.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reply command', () => {
  it('rejects missing threads', async () => {
    getMock.mockReturnValue(null)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as () => never)

    await expect(runCommand(replyCmd, { rawArgs: ['thread-1', 'hello'] })).rejects.toThrow('exit')

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('thread not found'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects resolved threads', async () => {
    getMock.mockReturnValue({ id: 'thread-1', status: 'resolved' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as () => never)

    await expect(runCommand(replyCmd, { rawArgs: ['thread-1', 'hello'] })).rejects.toThrow('exit')

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cannot reply to resolved thread'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('inserts an agent message for open threads', async () => {
    getMock.mockReturnValue({ id: 'thread-1', status: 'open', file_id: 'file-1' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand(replyCmd, { rawArgs: ['thread-1', 'hello world'] })

    expect(runMock).toHaveBeenCalledOnce()
    expect(runMock.mock.calls[0][0]).toBe('msg-agent')
    expect(runMock.mock.calls[0][1]).toBe('thread-1')
    expect(runMock.mock.calls[0][2]).toBe('hello world')
    expect(notifyThreadUpdatedMock).toHaveBeenCalledWith('file-1', 'thread-1', 'reply')

    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      threadId: 'thread-1',
      messageId: 'msg-agent',
    })
  })
})
