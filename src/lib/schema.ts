import { z } from 'zod'

/**
 * Single source of truth for MealForge's data model.
 *
 * - `zod` schemas validate everything that crosses a trust boundary
 *   (localStorage, the AI response).
 * - Plain JSON Schemas (PLAN_JSON_SCHEMA / MEAL_JSON_SCHEMA) are handed to the
 *   Anthropic API's structured-outputs feature so the model is *forced* to
 *   return shape-valid JSON. We still re-validate with zod defensively.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SEX = ['male', 'female'] as const
export const ACTIVITY_LEVELS = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const
export const GOALS = ['lose', 'maintain', 'gain'] as const
export const PACES = ['easy', 'steady', 'aggressive'] as const
export const DIETS = ['omnivore', 'vegetarian', 'vegan', 'pescatarian'] as const
export const PROTOCOLS = [
  'balanced',
  'high_protein_low_carb',
  'mediterranean',
  'plant_forward',
  'keto',
] as const
export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
] as const
export const INGREDIENT_CATEGORIES = [
  'produce',
  'protein',
  'dairy',
  'grains',
  'pantry',
  'spices',
  'frozen',
  'bakery',
  'condiments',
  'other',
] as const

export type Sex = (typeof SEX)[number]
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]
export type Goal = (typeof GOALS)[number]
export type Pace = (typeof PACES)[number]
export type Diet = (typeof DIETS)[number]
export type Protocol = (typeof PROTOCOLS)[number]
export type MealSlot = (typeof MEAL_SLOTS)[number]
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// Profile (canonical units are metric: kg + cm; `units` is display-only)
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  units: z.enum(['metric', 'imperial']).default('imperial'),
  sex: z.enum(SEX),
  age: z.number().int().min(13).max(100),
  heightCm: z.number().min(120).max(230),
  currentWeightKg: z.number().min(30).max(300),
  goalWeightKg: z.number().min(30).max(300),
  activityLevel: z.enum(ACTIVITY_LEVELS),
  goal: z.enum(GOALS),
  pace: z.enum(PACES),
  protocol: z.enum(PROTOCOLS),
  diet: z.enum(DIETS),
  mealsPerDay: z.number().int().min(2).max(5),
  snacks: z.boolean(),
  allergies: z.array(z.string()),
  restrictions: z.array(z.string()), // religious/ethical, e.g. halal, kosher
  dislikes: z.array(z.string()),
})
export type Profile = z.infer<typeof ProfileSchema>

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export const TargetsSchema = z.object({
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  source: z.enum(['computed', 'manual']),
  tolerance_pct: z.number().min(1).max(40),
  breakdown: z.object({
    bmr: z.number(),
    activityFactor: z.number(),
    tdee: z.number(),
    goalDelta: z.number(),
    proteinPerKg: z.number(),
    fatPctOfCalories: z.number(),
    steps: z.array(z.string()),
  }),
})
export type Targets = z.infer<typeof TargetsSchema>

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const MacrosSchema = z.object({
  kcal: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
})
export type Macros = z.infer<typeof MacrosSchema>

export const IngredientSchema = z.object({
  item: z.string(),
  amount: z.string(),
  category: z.enum(INGREDIENT_CATEGORIES),
})
export type Ingredient = z.infer<typeof IngredientSchema>

export const MealSchema = z.object({
  slot: z.enum(MEAL_SLOTS),
  title: z.string(),
  servings: z.number(),
  macros: MacrosSchema,
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  swappable: z.boolean(),
})
export type Meal = z.infer<typeof MealSchema>

export const DayPlanSchema = z.object({
  day: z.number().int(),
  meals: z.array(MealSchema),
})
export type DayPlan = z.infer<typeof DayPlanSchema>

export const PlanSchema = z.object({
  days: z.array(DayPlanSchema),
})
export type Plan = z.infer<typeof PlanSchema>

export const ShoppingItemSchema = z.object({
  category: z.enum(INGREDIENT_CATEGORIES),
  item: z.string(),
  totalAmount: z.string(),
})
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>

// What the model returns from the generate / swap endpoints.
export const GeneratedPlanSchema = z.object({ days: z.array(DayPlanSchema) })
export const GeneratedMealSchema = z.object({ meal: MealSchema })

// A persisted plan in localStorage.
export const SavedPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  profile: ProfileSchema,
  targets: TargetsSchema,
  plan: PlanSchema,
})
export type SavedPlan = z.infer<typeof SavedPlanSchema>

// ---------------------------------------------------------------------------
// JSON Schemas for Anthropic structured outputs
// (no min/max/length constraints — those aren't supported; additionalProperties
// must be false on every object.)
// ---------------------------------------------------------------------------

const macrosJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kcal: { type: 'number' },
    protein_g: { type: 'number' },
    carbs_g: { type: 'number' },
    fat_g: { type: 'number' },
  },
  required: ['kcal', 'protein_g', 'carbs_g', 'fat_g'],
}

const ingredientJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    item: { type: 'string' },
    amount: { type: 'string' },
    category: { type: 'string', enum: [...INGREDIENT_CATEGORIES] },
  },
  required: ['item', 'amount', 'category'],
}

const mealJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slot: { type: 'string', enum: [...MEAL_SLOTS] },
    title: { type: 'string' },
    servings: { type: 'number' },
    macros: macrosJson,
    ingredients: { type: 'array', items: ingredientJson },
    steps: { type: 'array', items: { type: 'string' } },
    swappable: { type: 'boolean' },
  },
  required: ['slot', 'title', 'servings', 'macros', 'ingredients', 'steps', 'swappable'],
}

const dayJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    day: { type: 'integer' },
    meals: { type: 'array', items: mealJson },
  },
  required: ['day', 'meals'],
}

export const PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    days: { type: 'array', items: dayJson },
  },
  required: ['days'],
} as const

export const MEAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meal: mealJson,
  },
  required: ['meal'],
} as const
