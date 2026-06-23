import type { MealSlot, Profile } from './schema'
import { cmToFtIn, kgToLb } from './targets'

/** Display helpers: convert canonical metric back to the user's chosen units. */

export function weightDisplay(kg: number, units: Profile['units']): string {
  return units === 'imperial' ? `${Math.round(kgToLb(kg))} lb` : `${kg.toFixed(1)} kg`
}

export function heightDisplay(cm: number, units: Profile['units']): string {
  if (units === 'imperial') {
    const { ft, inch } = cmToFtIn(cm)
    return `${ft}'${inch}"`
  }
  return `${Math.round(cm)} cm`
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

export const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: '🌅',
  lunch: '🥗',
  dinner: '🍽️',
  snack: '🍎',
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
