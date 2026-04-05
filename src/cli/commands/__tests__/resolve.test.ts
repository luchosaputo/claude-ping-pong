import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from 'citty'

const getMock = vi.fn()
const runMock = vi.fn()

vi.mock('../../../db.js', () => ({
  db: {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, status FROM threads')) {
        return { get: getMock }
      }
      if (sql.includes("UPDATE threads SET status = 'resolved'")) {
        return { run: runMock }
      }
      throw new Error(`Unexpected SQL in test: ${sql}`)
    }),
  },
}))

import resolveCmd from '../resolve.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolve command', () => {
  it('rejects missing threads', async () => {
    getMock.mockReturnValue(null)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as () => never)

    await expect(runCommand(resolveCmd, { rawArgs: ['thread-1'] })).rejects.toThrow('exit')

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('thread not found'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not update threads that are already resolved', async () => {
    getMock.mockReturnValue({ id: 'thread-1', status: 'resolved' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand(resolveCmd, { rawArgs: ['thread-1'] })

    expect(runMock).not.toHaveBeenCalled()
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      threadId: 'thread-1',
      status: 'resolved',
    })
  })

  it('marks open threads as resolved', async () => {
    getMock.mockReturnValue({ id: 'thread-1', status: 'open' })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCommand(resolveCmd, { rawArgs: ['thread-1'] })

    expect(runMock).toHaveBeenCalledOnce()
    expect(runMock).toHaveBeenCalledWith('thread-1')
    expect(JSON.parse(consoleSpy.mock.calls[0][0] as string)).toEqual({
      threadId: 'thread-1',
      status: 'resolved',
    })
  })
})
