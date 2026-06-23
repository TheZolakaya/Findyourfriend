import type { Plan, Profile, Targets } from './schema'
import { buildShoppingList, groupByCategory } from './shoppingList'
import { MEAL_SLOTS } from './schema'

/** Render a full plan (targets + days + shopping list) as Markdown. */
export function planToMarkdown(name: string, profile: Profile, targets: Targets, plan: Plan): string {
  const out: string[] = []
  out.push(`# ${name}`)
  out.push('')
  out.push(
    `_${profile.protocol.replace(/_/g, ' ')} · ${profile.goal} · ${profile.mealsPerDay} meals/day · ${plan.days.length} days_`,
  )
  out.push('')
  out.push('## Daily targets')
  out.push('')
  out.push('| Calories | Protein | Carbs | Fat |')
  out.push('|---|---|---|---|')
  out.push(`| ${targets.calories} kcal | ${targets.protein_g} g | ${targets.carbs_g} g | ${targets.fat_g} g |`)
  out.push('')

  for (const day of plan.days) {
    out.push(`## Day ${day.day}`)
    out.push('')
    const ordered = [...day.meals].sort(
      (a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot),
    )
    for (const meal of ordered) {
      out.push(`### ${cap(meal.slot)}: ${meal.title}`)
      out.push(
        `_${meal.macros.kcal} kcal · P ${meal.macros.protein_g}g · C ${meal.macros.carbs_g}g · F ${meal.macros.fat_g}g · serves ${meal.servings}_`,
      )
      out.push('')
      out.push('**Ingredients**')
      for (const ing of meal.ingredients) out.push(`- ${ing.amount} ${ing.item}`)
      out.push('')
      out.push('**Method**')
      meal.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`))
      out.push('')
    }
  }

  out.push('## Shopping list')
  out.push('')
  for (const group of groupByCategory(buildShoppingList(plan))) {
    out.push(`### ${cap(group.category)}`)
    for (const it of group.items) out.push(`- [ ] ${it.totalAmount} — ${it.item}`)
    out.push('')
  }

  return out.join('\n')
}

export function downloadText(filename: string, text: string, mime = 'text/markdown'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
