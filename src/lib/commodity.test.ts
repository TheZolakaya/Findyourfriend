import { describe, it, expect } from 'vitest'
import { purchaseFor } from './commodity'

describe('purchaseFor', () => {
  it('buys eggs by the dozen, rounded up', () => {
    expect(purchaseFor('Eggs', [{ unit: 'large', qty: 16.5 }])).toBe('2 dozen')
    expect(purchaseFor('Eggs', [{ unit: 'large', qty: 6 }])).toBe('1 dozen')
  })

  it('buys ground meat by the pound', () => {
    const p = purchaseFor('Lean ground turkey (93%)', [{ unit: 'oz', qty: 13.5 }])
    expect(p).toContain('1 lb')
  })

  it('buys canned tuna by the can, rounded up', () => {
    expect(purchaseFor('Canned tuna in water (5 oz)', [{ unit: 'can', qty: 1.5 }])).toContain('2 cans')
  })

  it('buys cottage cheese by the container', () => {
    expect(purchaseFor('Nonfat cottage cheese', [{ unit: 'cup', qty: 2 }])).toContain('container')
  })

  it('buys peppers by the each, combining cups and counts', () => {
    expect(
      purchaseFor('Bell pepper, diced', [
        { unit: 'cup', qty: 0.75 },
        { unit: 'large', qty: 1 },
      ]),
    ).toBe('2 bell peppers')
  })

  it('buys onion by the each from a tbsp amount', () => {
    expect(purchaseFor('Onion, diced', [{ unit: 'tbsp', qty: 3 }])).toBe('1 onion')
  })

  it('buys lemons rounded up to whole', () => {
    expect(purchaseFor('Lemon', [{ unit: '', qty: 1.25 }])).toBe('2 lemons')
  })

  it('converts weight to pounds with quarter-pound steps', () => {
    expect(purchaseFor('Cooked, peeled shrimp', [{ unit: 'oz', qty: 10 }])).toBe('0.75 lb')
  })

  it('returns null for compound items', () => {
    expect(purchaseFor('Zucchini + asparagus', [{ unit: 'cup', qty: 2 }])).toBeNull()
    expect(purchaseFor('Bok choy, peppers, bean sprouts, mushroom', [{ unit: 'cup', qty: 2.5 }])).toBeNull()
  })

  it('returns null for unknown ingredients', () => {
    expect(purchaseFor('Dragonfruit', [{ unit: 'cup', qty: 2 }])).toBeNull()
  })

  it('does not treat "X, diced" as compound', () => {
    expect(purchaseFor('Cucumber, sliced', [{ unit: 'medium', qty: 1 }])).toBe('1 cucumber')
  })
})
