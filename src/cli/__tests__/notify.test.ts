import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyThreadUpdated } from '../notify.js'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('notifyThreadUpdated', () => {
  it('posts thread updates to the local server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await notifyThreadUpdated('file-1', 'thread-1', 'reply')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3737/api/events/file-1/notify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      event: 'thread:updated',
      threadId: 'thread-1',
      type: 'reply',
    })
  })

  it('swallows network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(notifyThreadUpdated('file-1', 'thread-1', 'resolve')).resolves.toBeUndefined()
  })
})
