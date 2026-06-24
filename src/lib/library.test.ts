import { describe, it, expect } from 'vitest'
import { assemblePlan, assembleSwap, hasLibrary, scaleAmount } from './library'
import { computeTargets } from './targets'
import type { Profile } from './schema'

const phase1: Profile = {
  units: 'imperial',
  sex: 'male',
  age: 45,
  heightCm: 183,
  currentWeightKg: 140, // ~310 lb
  goalWeightKg: 113, // ~250 lb
  activityLevel: 'light',
  goal: 'lose',
  pace: 'steady',
  protocol: 'phase1',
  diet: 'omnivore',
  mealsPerDay: 4,
  snacks: true,
  allergies: [],
  restrictions: [],
  dislikes: [],
}

const targets = computeTargets(phase1)

describe('phase1 targets', () => {
  it('anchors protein to goal weight in the 150–185 band', () => {
    expect(targets.protein_g).toBeGreaterThanOrEqual(150)
    expect(targets.protein_g).toBeLessThanOrEqual(185)
  })
  it('keeps carbs and fat low (VLCD)', () => {
    expect(targets.carbs_g).toBeLessThanOrEqual(40)
    expect(targets.fat_g).toBeLessThanOrEqual(60)
    expect(targets.calories).toBeLessThan(1600)
  })
})

describe('library', () => {
  it('reports a library for phase1', () => {
    expect(hasLibrary('phase1')).toBe(true)
  })

  it('assembles real recipes — never the placeholder oats+chicken meal', () => {
    const plan = assemblePlan(phase1, targets, 3)
    expect(plan.days).toHaveLength(3)
    for (const day of plan.days) {
      expect(day.meals.length).toBe(phase1.mealsPerDay)
      for (const meal of day.meals) {
        const text = (meal.title + ' ' + meal.ingredients.map((i) => i.item).join(' ')).toLowerCase()
        expect(text).not.toContain('oats') // grains are not Phase 1-legal
        expect(meal.title).not.toBe('Overnight oats bowl')
      }
    }
  })

  it("lands the day's protein in a sensible range of target", () => {
    const plan = assemblePlan(phase1, targets, 2)
    for (const day of plan.days) {
      const protein = day.meals.reduce((s, m) => s + m.macros.protein_g, 0)
      expect(protein).toBeGreaterThan(targets.protein_g * 0.6)
      expect(protein).toBeLessThan(targets.protein_g * 1.6)
    }
  })

  it('respects an allergy (shrimp) — no excluded ingredient appears', () => {
    const allergic = { ...phase1, allergies: ['shrimp'] }
    const plan = assemblePlan(allergic, computeTargets(allergic), 4)
    for (const day of plan.days) {
      for (const meal of day.meals) {
        const text = (meal.title + ' ' + meal.ingredients.map((i) => i.item).join(' ')).toLowerCase()
        expect(text).not.toContain('shrimp')
      }
    }
  })

  it('varies meals across days', () => {
    const plan = assemblePlan(phase1, targets, 3)
    const day1 = plan.days[0].meals.map((m) => m.title).join('|')
    const day2 = plan.days[1].meals.map((m) => m.title).join('|')
    expect(day1).not.toBe(day2)
  })

  it('swaps a meal for a different recipe in the same slot', () => {
    const plan = assemblePlan(phase1, targets, 1)
    const dinner = plan.days[0].meals.find((m) => m.slot === 'dinner')!
    const swapped = assembleSwap(phase1, targets, dinner)
    expect(swapped.slot).toBe('dinner')
    expect(swapped.title).not.toBe(dinner.title)
  })
})

describe('scaleAmount', () => {
  it('scales quantity + unit', () => {
    expect(scaleAmount('4 oz', 1.5)).toBe('6 oz')
  })
  it('scales fractions', () => {
    expect(scaleAmount('1/2 cup', 2)).toBe('1 cup')
  })
  it('leaves non-numeric amounts alone', () => {
    expect(scaleAmount('to taste', 2)).toBe('to taste')
  })
})
