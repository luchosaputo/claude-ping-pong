import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn().mockReturnValue('mock-id'),
}))

vi.mock('@hono/node-server/serve-static', () => ({
  serveStatic: () => (_c: unknown, next: () => Promise<void>) => next(),
}))

vi.mock('../../db.js', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({ get: getMock, run: runMock }),
    transaction: vi.fn().mockImplementation((fn: () => void) => () => fn()),
  },
}))

import { nanoid } from 'nanoid'
import { db } from '../../db.js'
import { app } from '../app.js'

const mockPrepare = vi.mocked(db.prepare)
const mockTransaction = vi.mocked(db.transaction)
const mockNanoid = vi.mocked(nanoid)

function jsonRequest(body: unknown) {
  return app.request('/api/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getMock.mockReturnValue(null)
  runMock.mockReturnValue(undefined)
  mockPrepare.mockReturnValue({ get: getMock, run: runMock } as unknown as ReturnType<typeof db.prepare>)
  mockTransaction.mockImplementation((fn: () => void) => () => fn())
  mockNanoid.mockReturnValue('mock-id')
})

describe('POST /api/threads', () => {
  it('returns 400 when fileId is missing', async () => {
    const res = await jsonRequest({ selectedText: 'hello', body: 'comment' })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toMatch(/fileId/i)
  })

  it('returns 400 when selectedText is missing', async () => {
    const res = await jsonRequest({ fileId: 'f1', body: 'comment' })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toMatch(/selectedText/i)
  })

  it('returns 400 when body is missing', async () => {
    const res = await jsonRequest({ fileId: 'f1', selectedText: 'hello' })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toMatch(/body/i)
  })

  it('returns 404 when fileId does not exist in the database', async () => {
    getMock.mockReturnValue(null)

    const res = await jsonRequest({ fileId: 'nonexistent', selectedText: 'text', body: 'comment' })
    expect(res.status).toBe(404)
    const data = await res.json() as { error: string }
    expect(data.error).toMatch(/not found/i)
  })

  it('returns 201 with threadId and messageId on valid payload', async () => {
    getMock.mockReturnValue({ id: 'file-123' })
    mockNanoid.mockReturnValueOnce('thread-abc').mockReturnValueOnce('msg-xyz')

    const res = await jsonRequest({
      fileId: 'file-123',
      selectedText: 'el texto seleccionado',
      body: 'Este fragmento necesita más detalle',
      prefixContext: 'texto antes ',
      suffixContext: ' texto después',
      lineRangeStart: 10,
      lineRangeEnd: 10,
    })

    expect(res.status).toBe(201)
    const data = await res.json() as { threadId: string; messageId: string }
    expect(data.threadId).toBe('thread-abc')
    expect(data.messageId).toBe('msg-xyz')
  })

  it('inserts the thread and message inside a transaction', async () => {
    getMock.mockReturnValue({ id: 'file-123' })

    await jsonRequest({ fileId: 'file-123', selectedText: 'texto', body: 'comentario' })

    expect(mockTransaction).toHaveBeenCalledOnce()
    // prepare was called for: SELECT + 2 INSERTs = 3 times
    expect(mockPrepare).toHaveBeenCalledTimes(3)
    // The two INSERT run() calls happened
    expect(runMock).toHaveBeenCalledTimes(2)
  })

  it('inserts first message with author "user"', async () => {
    getMock.mockReturnValue({ id: 'file-123' })
    mockNanoid.mockReturnValueOnce('t1').mockReturnValueOnce('m1')

    await jsonRequest({ fileId: 'file-123', selectedText: 'frag', body: 'mi opinión' })

    const messageInsertCall = runMock.mock.calls[1]
    // run(messageId, threadId, author, body, created_at)
    expect(messageInsertCall[2]).toBe('user')
    expect(messageInsertCall[3]).toBe('mi opinión')
  })
})
