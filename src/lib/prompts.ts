import type { Meal, Profile, Targets } from './schema'
import { PROTOCOL_RULES } from './targets'
import { buildExclusions } from './validate'

/**
 * Every model instruction MealForge sends lives here so prompts are easy to
 * tune in one place. The deterministic constraints (targets, exclusions,
 * tolerance) are stated as hard rules; the model's job is creative, varied,
 * realistic recipes that respect them.
 */

function exclusionBlock(profile: Profile): string {
  const exclusions = buildExclusions(profile)
  const lines: string[] = []
  lines.push(`Dietary pattern: ${profile.diet}.`)
  if (profile.restrictions.length)
    lines.push(`Religious/ethical restrictions: ${profile.restrictions.join(', ')}.`)
  if (profile.allergies.length)
    lines.push(`ALLERGIES (life-threatening — never include, or anything derived from them): ${profile.allergies.join(', ')}.`)
  if (profile.dislikes.length) lines.push(`Disliked ingredients to avoid: ${profile.dislikes.join(', ')}.`)
  if (exclusions.length)
    lines.push(
      `Forbidden ingredient keywords (none of these may appear in any title or ingredient): ${exclusions.join(', ')}.`,
    )
  return lines.join('\n')
}

function targetsBlock(targets: Targets, profile: Profile): string {
  const rule = PROTOCOL_RULES[profile.protocol]
  return [
    `Protocol: ${rule.label} — ${rule.blurb}`,
    `Daily targets (per day, summed across all meals):`,
    `  • Calories: ${targets.calories} kcal`,
    `  • Protein: ${targets.protein_g} g`,
    `  • Carbs: ${targets.carbs_g} g`,
    `  • Fat: ${targets.fat_g} g`,
    `Tolerance: each day's totals must land within ±${targets.tolerance_pct}% of the calorie target (macros within ±${Math.round(
      targets.tolerance_pct * 1.5,
    )}%).`,
    `Meals per day: ${profile.mealsPerDay}${profile.snacks ? ' (you may use a "snack" slot)' : ' (no snacks)'}.`,
  ].join('\n')
}

export function buildSystemPrompt(profile: Profile, targets: Targets): string {
  return [
    'You are MealForge, an expert meal-plan and recipe generator working inside an app.',
    'You produce realistic, appetizing, varied recipes with concrete ingredient amounts and clear steps.',
    '',
    'HARD RULES (non-negotiable):',
    '1. Restrictions and allergies below are absolute. Never include a forbidden ingredient, or any ingredient derived from one.',
    '2. Hit the daily nutrition targets within the stated tolerance. Each meal carries its own macros; the per-day sum must match.',
    '3. Per-meal macros must be self-consistent: protein_g*4 + carbs_g*4 + fat_g*9 should be close to that meal\'s kcal.',
    '4. Use real, buyable ingredients with realistic amounts (grams, cups, tbsp, counts) and a sensible category for each.',
    '5. Vary meals across days — do not repeat the same dish unless asked. Aim for cuisine and ingredient variety.',
    '6. Return ONLY the JSON the schema requires. No prose, no markdown, no commentary.',
    '',
    '--- DIET & RESTRICTIONS ---',
    exclusionBlock(profile),
    '',
    '--- NUTRITION TARGETS ---',
    targetsBlock(targets, profile),
  ].join('\n')
}

export function buildPlanUserPrompt(opts: {
  days: number
  profile: Profile
  varietyHint?: string
}): string {
  const { days, profile, varietyHint } = opts
  const slots =
    profile.mealsPerDay <= 3
      ? ['breakfast', 'lunch', 'dinner'].slice(0, profile.mealsPerDay)
      : ['breakfast', 'lunch', 'dinner', 'snack', 'snack'].slice(0, profile.mealsPerDay)
  return [
    `Generate a ${days}-day meal plan with ${profile.mealsPerDay} meals per day.`,
    `Suggested slots per day: ${slots.join(', ')}.`,
    'Number the days 1 through ' + days + '.',
    'Each meal needs: slot, title, servings, macros, ingredients (item/amount/category), steps, and swappable=true.',
    varietyHint ? `Variety guidance: ${varietyHint}` : 'Make the days genuinely different from each other.',
  ].join('\n')
}

export function buildSwapUserPrompt(opts: {
  day: number
  slot: string
  replacing: Meal
  otherTitlesToday: string[]
}): string {
  const { slot, replacing, otherTitlesToday } = opts
  return [
    `Replace the ${slot} "${replacing.title}" with a DIFFERENT meal.`,
    `It must have approximately the same macros so the day still balances: ~${replacing.macros.kcal} kcal, ${replacing.macros.protein_g}g protein, ${replacing.macros.carbs_g}g carbs, ${replacing.macros.fat_g}g fat.`,
    otherTitlesToday.length
      ? `Do not duplicate the other meals today: ${otherTitlesToday.join(', ')}.`
      : '',
    `Keep slot "${slot}" and swappable=true. Return only the meal object.`,
  ]
    .filter(Boolean)
    .join('\n')
}
