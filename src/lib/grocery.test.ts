import { describe, it, expect } from 'vitest'
import { buildGroceryList, seasonForMonth, isStapleCategory } from './grocery'
import type { Plan } from './schema'

describe('seasonForMonth', () => {
  it('maps months to seasons (north)', () => {
    expect(seasonForMonth(0)).toBe('winter') // Jan
    expect(seasonForMonth(3)).toBe('spring') // Apr
    expect(seasonForMonth(5)).toBe('summer') // Jun
    expect(seasonForMonth(9)).toBe('fall') // Oct
  })
  it('flips for the southern hemisphere', () => {
    expect(seasonForMonth(5, 'south')).toBe('winter') // Jun in south
  })
})

describe('isStapleCategory', () => {
  it('treats pantry/spices/condiments as staples', () => {
    expect(isStapleCategory('pantry')).toBe(true)
    expect(isStapleCategory('spices')).toBe(true)
    expect(isStapleCategory('condiments')).toBe(true)
  })
  it('treats protein/produce/dairy as fresh', () => {
    expect(isStapleCategory('protein')).toBe(false)
    expect(isStapleCategory('produce')).toBe(false)
    expect(isStapleCategory('dairy')).toBe(false)
  })
})

const plan: Plan = {
  days: [
    {
      day: 1,
      meals: [
        {
          slot: 'dinner',
          title: 'Chicken & cucumber',
          servings: 1,
          macros: { kcal: 400, protein_g: 50, carbs_g: 8, fat_g: 12 },
          ingredients: [
            { item: 'Chicken breast', amount: '8 oz', category: 'protein' },
            { item: 'Cucumber', amount: '1 cup', category: 'produce' },
            { item: 'Olive oil', amount: '1 tsp', category: 'pantry' },
          ],
          steps: ['Cook'],
          swappable: true,
        },
      ],
    },
    {
      day: 2,
      meals: [
        {
          slot: 'dinner',
          title: 'Chicken again',
          servings: 1,
          macros: { kcal: 400, protein_g: 50, carbs_g: 8, fat_g: 12 },
          ingredients: [
            { item: 'Chicken breast', amount: '8 oz', category: 'protein' },
            { item: 'Cucumber', amount: '1 cup', category: 'produce' },
            { item: 'Cumin', amount: '1 tsp', category: 'spices' },
          ],
          steps: ['Cook'],
          swappable: true,
        },
      ],
    },
  ],
}

describe('buildGroceryList', () => {
  it('routes staples (oil, cumin) away from fresh', () => {
    const g = buildGroceryList(plan, { month: 5 })
    const stapleNames = g.staples.map((s) => s.item)
    expect(stapleNames).toContain('Olive oil')
    expect(stapleNames).toContain('Cumin')
    const freshNames = g.fresh.flatMap((c) => c.items.map((i) => i.item))
    expect(freshNames).not.toContain('Olive oil')
    expect(freshNames).toContain('Chicken breast')
  })

  it('sums fresh quantities and tracks the days that reuse them', () => {
    const g = buildGroceryList(plan, { month: 5 })
    const chicken = g.fresh.flatMap((c) => c.items).find((i) => i.item === 'Chicken breast')!
    expect(chicken.amount).toBe('16 oz') // 8 + 8
    expect(chicken.days).toEqual([1, 2])
    expect(chicken.mealCount).toBe(2)
  })

  it('does not sum staple amounts into nonsense', () => {
    const g = buildGroceryList(plan, { month: 5 })
    const oil = g.staples.find((s) => s.item === 'Olive oil')!
    expect(oil.amount).toBe('') // listed once, reused — no "0.66 tsp" total
    expect(oil.mealCount).toBe(1)
  })

  it('flags produce by season — cucumber is in season in summer, not winter', () => {
    const summer = buildGroceryList(plan, { month: 5 }) // Jun
    expect(summer.inSeasonNow).toContain('Cucumber')
    const winter = buildGroceryList(plan, { month: 0 }) // Jan
    expect(winter.inSeasonNow).not.toContain('Cucumber')
    expect(winter.outOfSeason).toContain('Cucumber')
  })
})
