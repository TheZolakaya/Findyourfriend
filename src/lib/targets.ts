import type {
  ActivityLevel,
  Goal,
  Pace,
  Profile,
  Protocol,
  Targets,
} from './schema'

/**
 * The deterministic, auditable core of MealForge.
 *
 * NO AI lives here. Every number a user sees comes from these pure functions
 * and is fully explained in `Targets.breakdown.steps`. Users can override any
 * target afterwards (source becomes "manual").
 *
 * Method: Mifflin–St Jeor BMR x activity factor (TDEE), adjusted by a
 * goal/pace calorie delta, then split into macros by the chosen protocol.
 */

// ---- Unit conversion -------------------------------------------------------

export const LB_PER_KG = 2.2046226218
export const lbToKg = (lb: number): number => lb / LB_PER_KG
export const kgToLb = (kg: number): number => kg * LB_PER_KG
export const inToCm = (inches: number): number => inches * 2.54
export const cmToIn = (cm: number): number => cm / 2.54
export const ftInToCm = (ft: number, inch: number): number => inToCm(ft * 12 + inch)
export const cmToFtIn = (cm: number): { ft: number; inch: number } => {
  const totalIn = Math.round(cmToIn(cm))
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}

// ---- Activity & pace tables ------------------------------------------------

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary — little or no exercise',
  light: 'Light — exercise 1–3 days/week',
  moderate: 'Moderate — exercise 3–5 days/week',
  active: 'Active — exercise 6–7 days/week',
  very_active: 'Very active — hard exercise or physical job',
}

// Daily calorie delta (kcal) applied for the goal at a given pace.
// Lose = deficit (negative), gain = surplus (positive), maintain = 0.
const PACE_DELTA: Record<Exclude<Goal, 'maintain'>, Record<Pace, number>> = {
  lose: { easy: -275, steady: -500, aggressive: -750 },
  gain: { easy: 175, steady: 350, aggressive: 500 },
}

export const PACE_LABELS: Record<Pace, string> = {
  easy: 'Easy — gradual',
  steady: 'Steady — recommended',
  aggressive: 'Aggressive — faster',
}

// ---- Protocol macro rules --------------------------------------------------
// Each protocol is defined transparently: grams of protein per kg of bodyweight,
// and fat as a percentage of total calories. Carbs fill the remainder.
export interface ProtocolRule {
  label: string
  blurb: string
  proteinPerKg: number
  fatPctOfCalories: number
}

export const PROTOCOL_RULES: Record<Protocol, ProtocolRule> = {
  balanced: {
    label: 'Balanced / flexible',
    blurb: 'Even split across protein, carbs, and fat.',
    proteinPerKg: 1.6,
    fatPctOfCalories: 0.3,
  },
  high_protein_low_carb: {
    label: 'High-protein, low-carb',
    blurb: 'Protein-forward with reduced carbohydrate.',
    proteinPerKg: 2.2,
    fatPctOfCalories: 0.35,
  },
  mediterranean: {
    label: 'Mediterranean',
    blurb: 'Healthy fats, fish, legumes, whole grains, lots of produce.',
    proteinPerKg: 1.6,
    fatPctOfCalories: 0.38,
  },
  plant_forward: {
    label: 'Plant-forward',
    blurb: 'Mostly plants; legumes, whole grains, nuts and seeds.',
    proteinPerKg: 1.4,
    fatPctOfCalories: 0.3,
  },
  keto: {
    label: 'Ketogenic',
    blurb: 'Very low carb, high fat.',
    proteinPerKg: 1.8,
    fatPctOfCalories: 0.7,
  },
}

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

// ---- Calculations ----------------------------------------------------------

export interface BmrInput {
  sex: 'male' | 'female'
  weightKg: number
  heightCm: number
  age: number
}

/** Mifflin–St Jeor resting metabolic rate (kcal/day). */
export function mifflinStJeorBMR({ sex, weightKg, heightCm, age }: BmrInput): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return base + (sex === 'male' ? 5 : -161)
}

/** Total daily energy expenditure: BMR x activity factor. */
export function tdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_FACTORS[activity]
}

/** Calorie delta for the goal at the chosen pace (kcal/day). */
export function goalDelta(goal: Goal, pace: Pace): number {
  if (goal === 'maintain') return 0
  return PACE_DELTA[goal][pace]
}

const round = (n: number): number => Math.round(n)

/**
 * Compute full daily targets from a profile.
 * Returns the four targets plus a step-by-step breakdown so nothing is a
 * black box.
 */
export function computeTargets(profile: Profile, tolerancePct = 10): Targets {
  const bmr = mifflinStJeorBMR({
    sex: profile.sex,
    weightKg: profile.currentWeightKg,
    heightCm: profile.heightCm,
    age: profile.age,
  })
  const factor = ACTIVITY_FACTORS[profile.activityLevel]
  const maintenance = tdee(bmr, profile.activityLevel)
  const delta = goalDelta(profile.goal, profile.pace)

  // Floor calories at a safe minimum to avoid unhealthily low plans.
  const minCalories = profile.sex === 'male' ? 1500 : 1200
  const calories = Math.max(minCalories, maintenance + delta)

  const rule = PROTOCOL_RULES[profile.protocol]
  const proteinG = profile.currentWeightKg * rule.proteinPerKg
  const fatKcal = calories * rule.fatPctOfCalories
  const fatG = fatKcal / KCAL_PER_G.fat
  const proteinKcal = proteinG * KCAL_PER_G.protein
  const carbsKcal = Math.max(0, calories - proteinKcal - fatKcal)
  const carbsG = carbsKcal / KCAL_PER_G.carbs

  const steps = [
    `BMR (Mifflin–St Jeor): 10 x ${profile.currentWeightKg.toFixed(1)}kg + 6.25 x ${profile.heightCm.toFixed(
      0,
    )}cm − 5 x ${profile.age} ${profile.sex === 'male' ? '+ 5' : '− 161'} = ${round(bmr)} kcal`,
    `Activity factor (${profile.activityLevel}): x${factor} → maintenance ≈ ${round(maintenance)} kcal/day`,
    delta === 0
      ? 'Goal "maintain": no calorie adjustment'
      : `Goal "${profile.goal}" at ${profile.pace} pace: ${delta > 0 ? '+' : ''}${delta} kcal/day`,
    calories === minCalories
      ? `Floored at the safe minimum of ${minCalories} kcal/day`
      : `Daily calorie target ≈ ${round(calories)} kcal`,
    `Protein: ${rule.proteinPerKg} g/kg x ${profile.currentWeightKg.toFixed(1)}kg = ${round(proteinG)} g`,
    `Fat: ${Math.round(rule.fatPctOfCalories * 100)}% of calories = ${round(fatG)} g`,
    `Carbs: remaining calories = ${round(carbsG)} g`,
  ]

  return {
    calories: round(calories),
    protein_g: round(proteinG),
    carbs_g: round(carbsG),
    fat_g: round(fatG),
    source: 'computed',
    tolerance_pct: tolerancePct,
    breakdown: {
      bmr: round(bmr),
      activityFactor: factor,
      tdee: round(maintenance),
      goalDelta: delta,
      proteinPerKg: rule.proteinPerKg,
      fatPctOfCalories: rule.fatPctOfCalories,
      steps,
    },
  }
}
