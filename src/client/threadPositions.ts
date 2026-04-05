export interface ThreadCardLayoutEntry {
  threadId: string
  idealTop: number
  height: number
}

export interface DraftCardLayout {
  top: number
  height: number
}

export const CARD_GAP = 8

export function computeThreadCardPositions(
  entries: ThreadCardLayoutEntry[],
  draftCard?: DraftCardLayout,
): Map<string, number> {
  const ordered = [...entries].sort((a, b) => a.idealTop - b.idealTop)
  if (!draftCard) {
    const positioned: Array<ThreadCardLayoutEntry & { top: number }> = []
    let nextAvailable = 0

    for (const entry of ordered) {
      const top = Math.max(entry.idealTop, nextAvailable)
      positioned.push({ ...entry, top })
      nextAvailable = top + entry.height + CARD_GAP
    }

    return new Map(positioned.map((entry) => [entry.threadId, entry.top]))
  }

  const draftTop = draftCard.top
  const draftBottom = draftCard.top + draftCard.height
  const above = ordered.filter((entry) => entry.idealTop <= draftTop)
  const below = ordered.filter((entry) => entry.idealTop > draftTop)
  const positions = new Map<string, number>()

  let nextBottom = draftTop - CARD_GAP
  for (let index = above.length - 1; index >= 0; index -= 1) {
    const entry = above[index]
    const top = Math.min(entry.idealTop, nextBottom - entry.height)
    positions.set(entry.threadId, top)
    nextBottom = top - CARD_GAP
  }

  let nextTop = draftBottom + CARD_GAP
  for (const entry of below) {
    const top = Math.max(entry.idealTop, nextTop)
    positions.set(entry.threadId, top)
    nextTop = top + entry.height + CARD_GAP
  }

  return positions
}
