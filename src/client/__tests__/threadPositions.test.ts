import { describe, expect, it } from 'vitest'
import { CARD_GAP, computeThreadCardPositions } from '../threadPositions.js'

describe('computeThreadCardPositions', () => {
  it('stacks overlapping thread cards downward by default', () => {
    const positions = computeThreadCardPositions([
      { threadId: 'a', idealTop: 100, height: 80 },
      { threadId: 'b', idealTop: 120, height: 80 },
    ])

    expect(positions.get('a')).toBe(100)
    expect(positions.get('b')).toBe(100 + 80 + CARD_GAP)
  })

  it('keeps the draft card position and shifts overlapping existing cards upward', () => {
    const positions = computeThreadCardPositions(
      [
        { threadId: 'older', idealTop: 120, height: 80 },
        { threadId: 'below', idealTop: 260, height: 80 },
      ],
      { top: 120, height: 140 },
    )

    expect(positions.get('older')).toBe(120 - CARD_GAP - 80)
    expect(positions.get('below')).toBe(120 + 140 + CARD_GAP)
  })

  it('propagates the temporary upward shift through preceding cards only when needed', () => {
    const positions = computeThreadCardPositions(
      [
        { threadId: 'top', idealTop: 40, height: 80 },
        { threadId: 'middle', idealTop: 130, height: 80 },
        { threadId: 'overlap', idealTop: 180, height: 80 },
      ],
      { top: 190, height: 120 },
    )

    expect(positions.get('overlap')).toBe(190 - CARD_GAP - 80)
    expect(positions.get('middle')).toBe(190 - (CARD_GAP * 2) - 160)
    expect(positions.get('top')).toBe(190 - (CARD_GAP * 3) - 240)
  })

  it('pushes overlapping cards downward when they are anchored below the draft', () => {
    const positions = computeThreadCardPositions(
      [
        { threadId: 'above', idealTop: 60, height: 80 },
        { threadId: 'below', idealTop: 180, height: 80 },
        { threadId: 'below-2', idealTop: 210, height: 80 },
      ],
      { top: 120, height: 140 },
    )

    expect(positions.get('above')).toBe(120 - CARD_GAP - 80)
    expect(positions.get('below')).toBe(120 + 140 + CARD_GAP)
    expect(positions.get('below-2')).toBe(120 + 140 + CARD_GAP + 80 + CARD_GAP)
  })

  it('reflows every stacked card below the draft to keep old comments separated', () => {
    const positions = computeThreadCardPositions(
      [
        { threadId: 'b1', idealTop: 180, height: 80 },
        { threadId: 'b2', idealTop: 190, height: 80 },
        { threadId: 'b3', idealTop: 200, height: 80 },
      ],
      { top: 120, height: 140 },
    )

    expect(positions.get('b1')).toBe(268)
    expect(positions.get('b2')).toBe(356)
    expect(positions.get('b3')).toBe(444)
  })

  it('reflows every stacked card above the draft to keep old comments separated', () => {
    const positions = computeThreadCardPositions(
      [
        { threadId: 'a1', idealTop: 150, height: 80 },
        { threadId: 'a2', idealTop: 160, height: 80 },
        { threadId: 'a3', idealTop: 170, height: 80 },
      ],
      { top: 220, height: 120 },
    )

    expect(positions.get('a3')).toBe(132)
    expect(positions.get('a2')).toBe(44)
    expect(positions.get('a1')).toBe(-44)
  })
})
