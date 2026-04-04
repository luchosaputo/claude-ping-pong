import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn() }
})

vi.mock('../../db.js', () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null),
    }),
  },
}))

// serveStatic y el fallback SPA no son relevantes para estos tests
vi.mock('@hono/node-server/serve-static', () => ({
  serveStatic: () => (_c: unknown, next: () => Promise<void>) => next(),
}))

import { existsSync, readFileSync } from 'fs'
import { db } from '../../db.js'
import { app } from '../app.js'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockPrepare = vi.mocked(db.prepare)

function makeGetMock(returnValue: unknown) {
  return mockPrepare.mockReturnValue({
    get: vi.fn().mockReturnValue(returnValue),
  } as unknown as ReturnType<typeof db.prepare>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/files/:fileId/content', () => {
  it('returns 404 when the fileId does not exist in the database', async () => {
    makeGetMock(null)

    const res = await app.request('/api/files/nonexistent/content')

    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 404 when the file is registered but missing from disk', async () => {
    makeGetMock({ path: '/some/deleted/file.md' })
    mockExistsSync.mockReturnValue(false)

    const res = await app.request('/api/files/valid-id/content')

    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/no longer exists/i)
  })

  it('returns 200 with the raw Markdown content when file exists', async () => {
    const markdownContent = '# Hello\n\nThis is a test document.'
    makeGetMock({ path: '/docs/test.md' })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(markdownContent)

    const res = await app.request('/api/files/valid-id/content')

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe(markdownContent)
  })

  it('reads the file from the path stored in the database', async () => {
    const filePath = '/project/docs/README.md'
    makeGetMock({ path: filePath })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('# README')

    await app.request('/api/files/abc123/content')

    expect(mockExistsSync).toHaveBeenCalledWith(filePath)
    expect(mockReadFileSync).toHaveBeenCalledWith(filePath, 'utf-8')
  })
})
