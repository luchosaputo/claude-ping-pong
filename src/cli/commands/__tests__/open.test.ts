import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCommand } from 'citty'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: vi.fn() }
})

vi.mock('../../../db.js', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
    }),
  },
}))

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({ unref: vi.fn(), pid: 1234 }),
}))

vi.mock('node-fetch', () => ({}))
global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { db } from '../../../db.js'
import openCmd from '../open.js'

const mockSpawn = vi.mocked(spawn)

const mockExistsSync = vi.mocked(existsSync)
const mockPrepare = vi.mocked(db.prepare)

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

  mockPrepare.mockReturnValue({
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  } as unknown as ReturnType<typeof db.prepare>)
})

describe('open command', () => {
  it('rejects non-markdown extensions', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { }) as () => never)

    await runCommand(openCmd, { rawArgs: ['document.txt'] })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('only Markdown files'),
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('rejects a missing file', async () => {
    mockExistsSync.mockReturnValue(false)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { }) as () => never)

    await runCommand(openCmd, { rawArgs: ['missing.md'] })

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file not found'))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('registers a new file and outputs fileId + url', async () => {
    mockExistsSync.mockReturnValue(true)
    const runMock = vi.fn()
    mockPrepare.mockReturnValue({
      get: vi.fn().mockReturnValue(null),
      run: runMock,
    } as unknown as ReturnType<typeof db.prepare>)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

    await runCommand(openCmd, { rawArgs: ['doc.md'] })

    expect(runMock).toHaveBeenCalledOnce()
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string) as {
      fileId: string
      url: string
    }
    expect(output.fileId).toBeTruthy()
    expect(output.url).toMatch(/http:\/\/localhost:\d+\/view\//)
  })

  it('spawns the server when the health check fails', async () => {
    mockExistsSync.mockReturnValue(true)
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true }) as unknown as typeof fetch

    await runCommand(openCmd, { rawArgs: ['doc.md'] })

    expect(mockSpawn).toHaveBeenCalledOnce()
  })

  it('returns the existing fileId without inserting a duplicate', async () => {
    mockExistsSync.mockReturnValue(true)
    const runMock = vi.fn()
    mockPrepare.mockReturnValue({
      get: vi.fn().mockReturnValue({ id: 'existing-id' }),
      run: runMock,
    } as unknown as ReturnType<typeof db.prepare>)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

    await runCommand(openCmd, { rawArgs: ['doc.md'] })

    expect(runMock).not.toHaveBeenCalled()
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string) as { fileId: string }
    expect(output.fileId).toBe('existing-id')
  })
})
