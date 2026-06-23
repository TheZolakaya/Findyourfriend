import { describe, it, expect } from 'vitest'
import { parseAmount, buildShoppingList, groupByCategory } from './shoppingList'
import type { Plan } from './schema'

describe('parseAmount', () => {
  it('parses quantity + unit', () => {
    expect(parseAmount('2 cups')).toEqual({ qty: 2, unit: 'cups', raw: '2 cups' })
  })
  it('parses fractions', () => {
    const p = parseAmount('1/2 tbsp')
    expect(p.qty).toBeCloseTo(0.5)
    expect(p.unit).toBe('tbsp')
  })
  it('parses grams', () => {
    expect(parseAmount('100 g').qty).toBe(100)
  })
  it('handles non-numeric amounts', () => {
    expect(parseAmount('to taste').qty).toBeNull()
  })
})

const plan: Plan = {
  days: [
    {
      day: 1,
      meals: [
        {
          slot: 'breakfast',
          title: 'Oats',
          servings: 1,
          macros: { kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 12 },
          ingredients: [
            { item: 'Rolled oats', amount: '80 g', category: 'grains' },
            { item: 'Banana', amount: '1', category: 'produce' },
          ],
          steps: ['Cook oats'],
          swappable: true,
        },
        {
          slot: 'lunch',
          title: 'Chicken bowl',
          servings: 1,
          macros: { kcal: 600, protein_g: 45, carbs_g: 40, fat_g: 20 },
          ingredients: [
            { item: 'Chicken breast', amount: '150 g', category: 'protein' },
            { item: 'Banana', amount: '1', category: 'produce' },
          ],
          steps: ['Grill chicken'],
          swappable: true,
        },
      ],
    },
    {
      day: 2,
      meals: [
        {
          slot: 'breakfast',
          title: 'Oats again',
          servings: 1,
          macros: { kcal: 400, protein_g: 20, carbs_g: 50, fat_g: 12 },
          ingredients: [{ item: 'Rolled oats', amount: '80 g', category: 'grains' }],
          steps: ['Cook oats'],
          swappable: true,
        },
      ],
    },
  ],
}

describe('buildShoppingList', () => {
  it('sums same item + unit across the plan', () => {
    const list = buildShoppingList(plan)
    const oats = list.find((i) => i.item === 'Rolled oats')
    expect(oats?.totalAmount).toBe('160 g')
  })

  it('combines unitless counts', () => {
    const list = buildShoppingList(plan)
    const banana = list.find((i) => i.item === 'Banana')
    expect(banana?.totalAmount).toBe('2')
  })

  it('assigns categories', () => {
    const list = buildShoppingList(plan)
    expect(list.find((i) => i.item === 'Chicken breast')?.category).toBe('protein')
  })

  it('groups by category in canonical order', () => {
    const grouped = groupByCategory(buildShoppingList(plan))
    const cats = grouped.map((g) => g.category)
    // produce comes before protein, protein before grains
    expect(cats.indexOf('produce')).toBeLessThan(cats.indexOf('protein'))
    expect(cats.indexOf('protein')).toBeLessThan(cats.indexOf('grains'))
  })
})
