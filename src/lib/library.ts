import type {
  DayPlan,
  Ingredient,
  Macros,
  Meal,
  MealSlot,
  Plan,
  Profile,
  Protocol,
  Targets,
} from './schema'
import { buildExclusions } from './validate'
import { PHASE1_RECIPES } from './recipesPhase1'

/**
 * Curated recipe library + a deterministic plan assembler.
 *
 * This is the trustworthy engine: real recipes with real amounts, picked to
 * hit the day's protein target (protein is what matters most for these
 * protocols). No AI at runtime — that keeps plans coherent, free, offline, and
 * means the public site can never serve nonsense or spend API credits.
 * Claude's role is to grow this library offline, validated against each
 * protocol's rules.
 */

export interface LibraryRecipe {
  id: string
  title: string
  protocols: Protocol[]
  slots: MealSlot[]
  servings: number
  macros: Macros // per single serving
  ingredients: Ingredient[]
  steps: string[]
  tags?: string[]
}

const ALL_RECIPES: LibraryRecipe[] = [...PHASE1_RECIPES]

/** Does a protocol have a curated library yet? If not, callers fall back. */
export function hasLibrary(protocol: Protocol): boolean {
  return ALL_RECIPES.some((r) => r.protocols.includes(protocol))
}

function recipesForProtocol(protocol: Protocol): LibraryRecipe[] {
  return ALL_RECIPES.filter((r) => r.protocols.includes(protocol))
}

function slotsFor(profile: Profile): MealSlot[] {
  const base: MealSlot[] = ['breakfast', 'lunch', 'dinner']
  const all: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'snack']
  return (profile.mealsPerDay <= 3 ? base : all).slice(0, profile.mealsPerDay)
}

// Relative share of the day's protein per slot (dinner carries the most).
const SLOT_PROTEIN_WEIGHT: Record<MealSlot, number> = {
  breakfast: 0.24,
  lunch: 0.28,
  dinner: 0.34,
  snack: 0.18,
}

function normWeight(slot: MealSlot, slots: MealSlot[]): number {
  const total = slots.reduce((s, sl) => s + SLOT_PROTEIN_WEIGHT[sl], 0)
  return SLOT_PROTEIN_WEIGHT[slot] / total
}

function excludedRecipe(r: LibraryRecipe, exclusions: string[]): boolean {
  const hay = [r.title, ...r.ingredients.map((i) => i.item)].join(' ').toLowerCase()
  return exclusions.some((ex) => hay.includes(ex))
}

const MULTS = [0.5, 1, 1.5, 2, 2.5, 3]
function snapMult(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  let best = MULTS[0]
  let bestDelta = Infinity
  for (const m of MULTS) {
    const d = Math.abs(m - ratio)
    if (d < bestDelta) {
      bestDelta = d
      best = m
    }
  }
  return best
}

/** Scale a free-form amount string ("4 oz", "1/2 cup") by a multiplier. */
export function scaleAmount(amount: string, mult: number): string {
  if (mult === 1) return amount
  const m = amount.match(/^\s*(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(.*)$/)
  if (!m) return amount
  let qty: number
  if (m[1].includes('/')) {
    const [a, b] = m[1].split('/').map((x) => parseFloat(x.trim()))
    qty = b ? a / b : a
  } else {
    qty = parseFloat(m[1])
  }
  if (!Number.isFinite(qty)) return amount
  const scaled = Number((qty * mult).toFixed(2))
  return `${scaled} ${m[2]}`.trim()
}

function scaleMacros(macros: Macros, mult: number): Macros {
  return {
    kcal: Math.round(macros.kcal * mult),
    protein_g: Math.round(macros.protein_g * mult),
    carbs_g: Math.round(macros.carbs_g * mult),
    fat_g: Math.round(macros.fat_g * mult),
  }
}

function recipeToMeal(r: LibraryRecipe, slot: MealSlot, mult: number): Meal {
  return {
    slot,
    title: r.title,
    servings: Number((r.servings * mult).toFixed(2)),
    macros: scaleMacros(r.macros, mult),
    ingredients:
      mult === 1
        ? r.ingredients
        : r.ingredients.map((i) => ({ ...i, amount: scaleAmount(i.amount, mult) })),
    steps: r.steps,
    swappable: true,
  }
}

function rotate<T>(arr: T[], by: number): T[] {
  if (!arr.length) return arr
  const k = ((by % arr.length) + arr.length) % arr.length
  return [...arr.slice(k), ...arr.slice(0, k)]
}

export function assembleDay(profile: Profile, targets: Targets, day: number): DayPlan {
  const exclusions = buildExclusions(profile)
  const pool = recipesForProtocol(profile.protocol).filter((r) => !excludedRecipe(r, exclusions))
  const slots = slotsFor(profile)
  const dayIdx = day - 1
  const used = new Set<string>()
  const meals: Meal[] = []

  slots.forEach((slot, i) => {
    const slotCandidates = pool.filter((r) => r.slots.includes(slot))
    const candidates = slotCandidates.length ? slotCandidates : pool
    if (!candidates.length) return
    // Rotate by day+slot for variety; prefer one not already used today.
    const ordered = rotate(candidates, dayIdx * 2 + i)
    const pick = ordered.find((r) => !used.has(r.id)) ?? ordered[0]
    used.add(pick.id)

    const slotProtein = targets.protein_g * normWeight(slot, slots)
    const mult = snapMult(slotProtein / Math.max(1, pick.macros.protein_g))
    meals.push(recipeToMeal(pick, slot, mult))
  })

  return { day, meals }
}

export function assemblePlan(profile: Profile, targets: Targets, days: number): Plan {
  return { days: Array.from({ length: days }, (_, i) => assembleDay(profile, targets, i + 1)) }
}

/** Swap a single meal for a different library recipe in the same slot. */
export function assembleSwap(profile: Profile, _targets: Targets, replacing: Meal): Meal {
  const exclusions = buildExclusions(profile)
  const pool = recipesForProtocol(profile.protocol)
    .filter((r) => !excludedRecipe(r, exclusions))
    .filter((r) => r.slots.includes(replacing.slot) && r.title !== replacing.title)
  if (!pool.length) return replacing

  // Pick the recipe whose protein is closest to what we're replacing.
  const target = replacing.macros.protein_g
  const pick = [...pool].sort(
    (a, b) =>
      Math.abs(a.macros.protein_g - target) - Math.abs(b.macros.protein_g - target),
  )[0]
  const mult = snapMult(target / Math.max(1, pick.macros.protein_g))
  return recipeToMeal(pick, replacing.slot, mult)
}
