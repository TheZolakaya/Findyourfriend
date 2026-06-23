import type { DayPlan, Diet, Ingredient, Meal, MealSlot, Plan, Profile, Targets } from './schema'

/**
 * Deterministic mock plan generator. Lets the entire UI be built and used
 * before (or without) the live AI. It roughly hits the targets and respects
 * the diet pattern, so the validation panel behaves realistically.
 *
 * This is NOT the product's recipe quality — it's scaffolding. The live model
 * produces the real variety.
 */

// Fraction of daily calories per slot, by meal count.
const SPLITS: Record<number, Partial<Record<MealSlot, number>>[]> = {
  2: [{ breakfast: 0.45, dinner: 0.55 }],
  3: [{ breakfast: 0.3, lunch: 0.35, dinner: 0.35 }],
  4: [{ breakfast: 0.27, lunch: 0.31, dinner: 0.31, snack: 0.11 }],
  5: [{ breakfast: 0.25, lunch: 0.28, dinner: 0.28, snack: 0.1 }],
}

function slotsFor(profile: Profile): MealSlot[] {
  const base: MealSlot[] = ['breakfast', 'lunch', 'dinner']
  const all: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'snack']
  return (profile.mealsPerDay <= 3 ? base : all).slice(0, profile.mealsPerDay)
}

// A protein source that fits the diet pattern.
function proteinFor(diet: Diet, dayIdx: number): { item: string; category: Ingredient['category'] } {
  const pools: Record<Diet, { item: string; category: Ingredient['category'] }[]> = {
    omnivore: [
      { item: 'Chicken breast', category: 'protein' },
      { item: 'Lean ground turkey', category: 'protein' },
      { item: 'Sirloin steak', category: 'protein' },
    ],
    pescatarian: [
      { item: 'Salmon fillet', category: 'protein' },
      { item: 'Canned tuna', category: 'protein' },
      { item: 'Shrimp', category: 'protein' },
    ],
    vegetarian: [
      { item: 'Greek yogurt', category: 'dairy' },
      { item: 'Eggs', category: 'protein' },
      { item: 'Cottage cheese', category: 'dairy' },
    ],
    vegan: [
      { item: 'Firm tofu', category: 'protein' },
      { item: 'Cooked lentils', category: 'protein' },
      { item: 'Chickpeas', category: 'protein' },
    ],
  }
  const pool = pools[diet]
  return pool[dayIdx % pool.length]
}

const TITLES: Record<MealSlot, string[]> = {
  breakfast: ['Overnight oats bowl', 'Veggie scramble plate', 'Berry protein porridge', 'Savory grain bowl'],
  lunch: ['Power grain bowl', 'Big garden salad', 'Wrap & slaw', 'Buddha bowl'],
  dinner: ['Sheet-pan dinner', 'Stir-fry & rice', 'Roast & vegetables', 'Hearty skillet'],
  snack: ['Fruit & nuts', 'Yogurt cup', 'Hummus & veg', 'Trail mix'],
}

function buildMeal(
  slot: MealSlot,
  calories: number,
  macroFrac: { p: number; c: number; f: number },
  profile: Profile,
  dayIdx: number,
): Meal {
  const protein_g = Math.round((calories * macroFrac.p) / 4)
  const carbs_g = Math.round((calories * macroFrac.c) / 4)
  const fat_g = Math.round((calories * macroFrac.f) / 9)
  const protein = proteinFor(profile.diet, dayIdx + slot.length)
  const title = TITLES[slot][dayIdx % TITLES[slot].length]

  const ingredients: Ingredient[] = [
    { item: protein.item, amount: `${Math.max(80, Math.round(protein_g * 4))} g`, category: protein.category },
    { item: 'Mixed vegetables', amount: '1.5 cups', category: 'produce' },
    { item: 'Olive oil', amount: '1 tbsp', category: 'pantry' },
  ]
  if (slot === 'breakfast') ingredients.push({ item: 'Rolled oats', amount: '60 g', category: 'grains' })
  else if (slot !== 'snack') ingredients.push({ item: 'Brown rice', amount: '1 cup cooked', category: 'grains' })
  else ingredients.push({ item: 'Almonds', amount: '20 g', category: 'pantry' })

  return {
    slot,
    title,
    servings: 1,
    macros: { kcal: Math.round(calories), protein_g, carbs_g, fat_g },
    ingredients,
    steps: [
      `Prep the ${protein.item.toLowerCase()} and vegetables.`,
      'Cook through, season to taste, and combine.',
      'Plate and serve.',
    ],
    swappable: true,
  }
}

export function makeMockDay(profile: Profile, targets: Targets, day: number): DayPlan {
  const dayIdx = day - 1
  const slots = slotsFor(profile)
  const split = SPLITS[profile.mealsPerDay]?.[0] ?? SPLITS[3][0]
  // Normalize the split across the actual slots used.
  const weights = slots.map((s) => split[s] ?? 1 / slots.length)
  const wSum = weights.reduce((a, b) => a + b, 0)

  // Macro fractions of total calories, from the day targets.
  const pKcal = targets.protein_g * 4
  const cKcal = targets.carbs_g * 4
  const fKcal = targets.fat_g * 9
  const tot = pKcal + cKcal + fKcal || 1
  const macroFrac = { p: pKcal / tot, c: cKcal / tot, f: fKcal / tot }

  const meals = slots.map((slot, i) =>
    buildMeal(slot, (targets.calories * weights[i]) / wSum, macroFrac, profile, dayIdx),
  )
  return { day, meals }
}

export function makeMockPlan(profile: Profile, targets: Targets, days: number): Plan {
  return { days: Array.from({ length: days }, (_, i) => makeMockDay(profile, targets, i + 1)) }
}

export function makeMockMeal(profile: Profile, _targets: Targets, replacing: Meal): Meal {
  // Keep the replaced meal's macros; rotate the title to something different.
  const pool = TITLES[replacing.slot]
  const idx = (pool.indexOf(replacing.title) + 1) % pool.length
  const macroFrac = {
    p: (replacing.macros.protein_g * 4) / replacing.macros.kcal,
    c: (replacing.macros.carbs_g * 4) / replacing.macros.kcal,
    f: (replacing.macros.fat_g * 9) / replacing.macros.kcal,
  }
  const meal = buildMeal(replacing.slot, replacing.macros.kcal, macroFrac, profile, idx + 1)
  meal.title = pool[idx]
  meal.macros = replacing.macros
  return meal
}
