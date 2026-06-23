import type { DayPlan, Diet, Meal, Plan, Profile, Targets } from './schema'

/**
 * Code-side validation. Hard restrictions (allergies, diet, exclusions) are
 * NEVER trusted to the model — we verify them here, and the server regenerates
 * any day that fails. This is the trust boundary that makes the tool safe.
 */

// Diet patterns expand to forbidden ingredient keywords.
const DIET_FORBIDDEN: Record<Diet, string[]> = {
  omnivore: [],
  pescatarian: [
    'chicken',
    'beef',
    'pork',
    'lamb',
    'turkey',
    'bacon',
    'ham',
    'sausage',
    'veal',
    'venison',
    'duck',
    'gelatin',
  ],
  vegetarian: [
    'chicken',
    'beef',
    'pork',
    'lamb',
    'turkey',
    'bacon',
    'ham',
    'sausage',
    'veal',
    'venison',
    'duck',
    'fish',
    'salmon',
    'tuna',
    'cod',
    'shrimp',
    'prawn',
    'crab',
    'lobster',
    'anchovy',
    'sardine',
    'gelatin',
  ],
  vegan: [
    'chicken',
    'beef',
    'pork',
    'lamb',
    'turkey',
    'bacon',
    'ham',
    'sausage',
    'veal',
    'venison',
    'duck',
    'fish',
    'salmon',
    'tuna',
    'cod',
    'shrimp',
    'prawn',
    'crab',
    'lobster',
    'anchovy',
    'sardine',
    'gelatin',
    'milk',
    'cheese',
    'butter',
    'cream',
    'yogurt',
    'yoghurt',
    'egg',
    'honey',
    'whey',
    'casein',
    'ghee',
  ],
}

/**
 * The consolidated list of forbidden keywords for a profile: diet pattern +
 * allergies + religious/ethical restrictions + dislikes. Lower-cased, deduped.
 */
export function buildExclusions(profile: Profile): string[] {
  const set = new Set<string>()
  for (const k of DIET_FORBIDDEN[profile.diet]) set.add(k)
  for (const a of profile.allergies) if (a.trim()) set.add(a.trim().toLowerCase())
  for (const d of profile.dislikes) if (d.trim()) set.add(d.trim().toLowerCase())
  // Religious/ethical restrictions: keep both the label (for the prompt) and
  // a few obvious keyword expansions used for the keyword scan.
  for (const r of profile.restrictions) {
    const rl = r.trim().toLowerCase()
    if (!rl) continue
    if (rl === 'halal' || rl === 'kosher') {
      set.add('pork')
      set.add('bacon')
      set.add('ham')
      if (rl === 'halal') set.add('alcohol')
    } else {
      set.add(rl)
    }
  }
  return [...set]
}

export interface ExclusionViolation {
  day: number
  slot: string
  title: string
  item: string
  matched: string
}

/** Scan a meal's title + ingredients for any excluded keyword. */
function scanMeal(meal: Meal, day: number, exclusions: string[]): ExclusionViolation[] {
  const violations: ExclusionViolation[] = []
  const hay = (s: string) => s.toLowerCase()
  for (const ex of exclusions) {
    if (hay(meal.title).includes(ex)) {
      violations.push({ day, slot: meal.slot, title: meal.title, item: meal.title, matched: ex })
    }
    for (const ing of meal.ingredients) {
      if (hay(ing.item).includes(ex)) {
        violations.push({ day, slot: meal.slot, title: meal.title, item: ing.item, matched: ex })
      }
    }
  }
  return violations
}

export interface DayMacroCheck {
  day: number
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
  withinTolerance: boolean
  deltas: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } // signed % off target
}

export function sumDayMacros(day: DayPlan): DayMacroCheck['totals'] {
  return day.meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.macros.kcal,
      protein_g: acc.protein_g + m.macros.protein_g,
      carbs_g: acc.carbs_g + m.macros.carbs_g,
      fat_g: acc.fat_g + m.macros.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  )
}

const pctOff = (actual: number, target: number): number =>
  target === 0 ? 0 : ((actual - target) / target) * 100

export function checkDayMacros(day: DayPlan, targets: Targets): DayMacroCheck {
  const totals = sumDayMacros(day)
  const deltas = {
    kcal: pctOff(totals.kcal, targets.calories),
    protein_g: pctOff(totals.protein_g, targets.protein_g),
    carbs_g: pctOff(totals.carbs_g, targets.carbs_g),
    fat_g: pctOff(totals.fat_g, targets.fat_g),
  }
  // Calories are the primary gate; macros use a looser band (1.5x) since they
  // are harder to hit exactly while staying appetizing.
  const tol = targets.tolerance_pct
  const withinTolerance =
    Math.abs(deltas.kcal) <= tol &&
    Math.abs(deltas.protein_g) <= tol * 1.5 &&
    Math.abs(deltas.carbs_g) <= tol * 1.5 &&
    Math.abs(deltas.fat_g) <= tol * 1.5
  return { day: day.day, totals, withinTolerance, deltas }
}

export interface PlanValidation {
  ok: boolean
  exclusionViolations: ExclusionViolation[]
  macroChecks: DayMacroCheck[]
  failingDays: number[] // day numbers that need regeneration
}

export function validatePlan(plan: Plan, targets: Targets, profile: Profile): PlanValidation {
  const exclusions = buildExclusions(profile)
  const exclusionViolations: ExclusionViolation[] = []
  const macroChecks: DayMacroCheck[] = []
  const failing = new Set<number>()

  for (const day of plan.days) {
    const dayViolations = day.meals.flatMap((m) => scanMeal(m, day.day, exclusions))
    if (dayViolations.length) {
      exclusionViolations.push(...dayViolations)
      failing.add(day.day)
    }
    const macro = checkDayMacros(day, targets)
    macroChecks.push(macro)
    if (!macro.withinTolerance) failing.add(day.day)
  }

  return {
    ok: exclusionViolations.length === 0 && macroChecks.every((m) => m.withinTolerance),
    exclusionViolations,
    macroChecks,
    failingDays: [...failing].sort((a, b) => a - b),
  }
}
