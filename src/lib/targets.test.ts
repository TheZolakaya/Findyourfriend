import { describe, it, expect } from 'vitest'
import {
  mifflinStJeorBMR,
  tdee,
  goalDelta,
  computeTargets,
  lbToKg,
  kgToLb,
  ftInToCm,
  cmToFtIn,
  ACTIVITY_FACTORS,
} from './targets'
import type { Profile } from './schema'

describe('unit conversions', () => {
  it('round-trips kg <-> lb', () => {
    expect(kgToLb(lbToKg(180))).toBeCloseTo(180, 5)
  })
  it('converts ft/in to cm', () => {
    // 5'10" = 70 in = 177.8 cm
    expect(ftInToCm(5, 10)).toBeCloseTo(177.8, 1)
  })
  it('round-trips cm -> ft/in', () => {
    const { ft, inch } = cmToFtIn(177.8)
    expect(ft).toBe(5)
    expect(inch).toBe(10)
  })
})

describe('mifflinStJeorBMR', () => {
  // Reference: male, 80kg, 180cm, 30y => 10*80 + 6.25*180 - 5*30 + 5 = 1780
  it('computes male BMR', () => {
    expect(mifflinStJeorBMR({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 })).toBeCloseTo(
      1780,
      5,
    )
  })
  // Reference: female, 65kg, 165cm, 30y => 10*65 + 6.25*165 - 5*30 - 161 = 1370.25
  it('computes female BMR', () => {
    expect(mifflinStJeorBMR({ sex: 'female', weightKg: 65, heightCm: 165, age: 30 })).toBeCloseTo(
      1370.25,
      5,
    )
  })
})

describe('tdee', () => {
  it('applies the activity factor', () => {
    expect(tdee(1780, 'moderate')).toBeCloseTo(1780 * ACTIVITY_FACTORS.moderate, 5)
  })
})

describe('goalDelta', () => {
  it('is zero for maintain', () => {
    expect(goalDelta('maintain', 'steady')).toBe(0)
  })
  it('is a deficit for lose', () => {
    expect(goalDelta('lose', 'steady')).toBeLessThan(0)
  })
  it('is a surplus for gain', () => {
    expect(goalDelta('gain', 'steady')).toBeGreaterThan(0)
  })
  it('scales with pace', () => {
    expect(Math.abs(goalDelta('lose', 'aggressive'))).toBeGreaterThan(
      Math.abs(goalDelta('lose', 'easy')),
    )
  })
})

const baseProfile: Profile = {
  units: 'metric',
  sex: 'male',
  age: 30,
  heightCm: 180,
  currentWeightKg: 80,
  goalWeightKg: 75,
  activityLevel: 'moderate',
  goal: 'lose',
  pace: 'steady',
  protocol: 'high_protein_low_carb',
  diet: 'omnivore',
  mealsPerDay: 3,
  snacks: true,
  allergies: [],
  restrictions: [],
  dislikes: [],
}

describe('computeTargets', () => {
  it('produces consistent macro/calorie math', () => {
    const t = computeTargets(baseProfile)
    // calories from macros should be within rounding distance of the calorie target
    const kcalFromMacros = t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9
    expect(Math.abs(kcalFromMacros - t.calories)).toBeLessThan(30)
  })

  it('applies the deficit for weight loss', () => {
    const t = computeTargets(baseProfile)
    expect(t.calories).toBeLessThan(t.breakdown.tdee)
  })

  it('applies the surplus for weight gain', () => {
    const t = computeTargets({ ...baseProfile, goal: 'gain' })
    expect(t.calories).toBeGreaterThan(t.breakdown.tdee)
  })

  it('gives higher protein for high-protein protocol than balanced', () => {
    const hp = computeTargets({ ...baseProfile, protocol: 'high_protein_low_carb' })
    const bal = computeTargets({ ...baseProfile, protocol: 'balanced' })
    expect(hp.protein_g).toBeGreaterThan(bal.protein_g)
  })

  it('gives keto far fewer carbs than balanced', () => {
    const keto = computeTargets({ ...baseProfile, protocol: 'keto' })
    const bal = computeTargets({ ...baseProfile, protocol: 'balanced' })
    expect(keto.carbs_g).toBeLessThan(bal.carbs_g)
  })

  it('never produces negative carbs', () => {
    const t = computeTargets({ ...baseProfile, protocol: 'keto', currentWeightKg: 120 })
    expect(t.carbs_g).toBeGreaterThanOrEqual(0)
  })

  it('floors calories at a safe minimum', () => {
    const tiny = computeTargets({
      ...baseProfile,
      sex: 'female',
      currentWeightKg: 45,
      heightCm: 150,
      age: 60,
      goal: 'lose',
      pace: 'aggressive',
      activityLevel: 'sedentary',
    })
    expect(tiny.calories).toBeGreaterThanOrEqual(1200)
  })

  it('emits a human-readable breakdown', () => {
    const t = computeTargets(baseProfile)
    expect(t.breakdown.steps.length).toBeGreaterThan(4)
    expect(t.breakdown.steps[0]).toMatch(/BMR/)
  })
})
