import type { IngredientCategory, Plan } from './schema'
import { INGREDIENT_CATEGORIES } from './schema'
import { parseAmount } from './shoppingList'
import { purchaseFor } from './commodity'

/**
 * Smart grocery list.
 *
 * Splits the plan's ingredients into:
 *  - STAPLES — shelf-stable, reusable (oil, spices, condiments, sweetener).
 *    Bought once; a jar covers the whole plan. We don't sum teaspoons into a
 *    nonsensical total — we list the item and note how many meals reuse it.
 *  - FRESH — proteins, produce, dairy bought for the week. Quantities summed,
 *    and tagged with which days use them so you cook-once / reuse.
 *
 * Plus seasonality: produce is flagged by what's in season now, so the list
 * leans toward fresh, sensible vegetables. All deterministic — no AI.
 */

export type Season = 'spring' | 'summer' | 'fall' | 'winter'
export type Hemisphere = 'north' | 'south'

const STAPLE_CATEGORIES: IngredientCategory[] = ['pantry', 'spices', 'condiments']
export function isStapleCategory(c: IngredientCategory): boolean {
  return STAPLE_CATEGORIES.includes(c)
}

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter',
}

/** Meteorological season from a 0-indexed month, hemisphere-aware. */
export function seasonForMonth(month0: number, hemisphere: Hemisphere = 'north'): Season {
  const m = ((month0 % 12) + 12) % 12
  let s: Season
  if (m === 11 || m === 0 || m === 1) s = 'winter'
  else if (m >= 2 && m <= 4) s = 'spring'
  else if (m >= 5 && m <= 7) s = 'summer'
  else s = 'fall'
  if (hemisphere === 'south') {
    const flip: Record<Season, Season> = { winter: 'summer', spring: 'fall', summer: 'winter', fall: 'spring' }
    s = flip[s]
  }
  return s
}

// Rough peak-season windows for common produce (keyword match on the item).
const PRODUCE_SEASONS: { match: string; seasons: Season[] }[] = [
  { match: 'asparagus', seasons: ['spring'] },
  { match: 'zucchini', seasons: ['summer', 'fall'] },
  { match: 'cucumber', seasons: ['summer'] },
  { match: 'bell pepper', seasons: ['summer', 'fall'] },
  { match: 'hot pepper', seasons: ['summer', 'fall'] },
  { match: 'pepper', seasons: ['summer', 'fall'] },
  { match: 'tomato', seasons: ['summer', 'fall'] },
  { match: 'spinach', seasons: ['spring', 'fall'] },
  { match: 'broccoli', seasons: ['spring', 'fall', 'winter'] },
  { match: 'cauliflower', seasons: ['fall', 'winter'] },
  { match: 'cabbage', seasons: ['fall', 'winter'] },
  { match: 'kale', seasons: ['fall', 'winter'] },
  { match: 'bok choy', seasons: ['spring', 'fall', 'winter'] },
  { match: 'radish', seasons: ['spring', 'fall'] },
  { match: 'celery', seasons: ['summer', 'fall'] },
  { match: 'lettuce', seasons: ['spring', 'fall'] },
  { match: 'romaine', seasons: ['spring', 'fall'] },
  { match: 'arugula', seasons: ['spring', 'fall'] },
  { match: 'lemon', seasons: ['winter', 'spring'] },
  { match: 'lime', seasons: ['summer', 'fall'] },
  // year-round-ish — leave these unflagged (null) so they never read "out of season"
]

function seasonsForItem(itemLower: string): Season[] | null {
  for (const entry of PRODUCE_SEASONS) {
    if (itemLower.includes(entry.match)) return entry.seasons
  }
  return null
}

export interface GroceryItem {
  item: string
  category: IngredientCategory
  staple: boolean
  amount: string // summed recipe need for fresh; '' for staples (one purchase)
  purchase: string | null // how you'd actually buy it ("2 dozen"); null if unknown
  days: number[] // plan days this item is used on
  mealCount: number // how many meals reuse it
  seasons: Season[] | null // produce only; null = unknown / year-round
  inSeason: boolean | null
}

export interface SmartGroceryList {
  season: Season
  fresh: { category: IngredientCategory; items: GroceryItem[] }[]
  staples: GroceryItem[]
  inSeasonNow: string[]
  outOfSeason: string[]
}

const categoryOrder = (c: IngredientCategory): number => INGREDIENT_CATEGORIES.indexOf(c)
const formatQty = (qty: number): string => Number(qty.toFixed(2)).toString()

interface Bucket {
  item: string
  category: IngredientCategory
  byUnit: Map<string, number>
  extras: string[]
  days: Set<number>
  mealCount: number
}

export function buildGroceryList(
  plan: Plan,
  opts: { month?: number; hemisphere?: Hemisphere } = {},
): SmartGroceryList {
  const hemisphere = opts.hemisphere ?? 'north'
  const month = opts.month ?? new Date().getMonth()
  const season = seasonForMonth(month, hemisphere)

  const buckets = new Map<string, Bucket>()
  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        const key = `${ing.category}::${ing.item.trim().toLowerCase()}`
        let b = buckets.get(key)
        if (!b) {
          b = { item: ing.item.trim(), category: ing.category, byUnit: new Map(), extras: [], days: new Set(), mealCount: 0 }
          buckets.set(key, b)
        }
        b.days.add(day.day)
        b.mealCount += 1
        const parsed = parseAmount(ing.amount)
        if (parsed.qty !== null) {
          b.byUnit.set(parsed.unit, (b.byUnit.get(parsed.unit) ?? 0) + parsed.qty)
        } else if (parsed.raw) {
          b.extras.push(parsed.raw)
        }
      }
    }
  }

  const items: GroceryItem[] = []
  for (const b of buckets.values()) {
    const staple = isStapleCategory(b.category)
    const seasons = b.category === 'produce' ? seasonsForItem(b.item.toLowerCase()) : null
    let amount = ''
    let purchase: string | null = null
    if (!staple) {
      const parts: string[] = []
      for (const [unit, qty] of b.byUnit) parts.push(unit ? `${formatQty(qty)} ${unit}` : formatQty(qty))
      parts.push(...dedupe(b.extras))
      amount = parts.join(' + ') || '—'
      const quantities = [...b.byUnit.entries()].map(([unit, qty]) => ({ unit, qty }))
      purchase = purchaseFor(b.item, quantities)
    }
    items.push({
      item: b.item,
      category: b.category,
      staple,
      amount,
      purchase,
      days: [...b.days].sort((a, c) => a - c),
      mealCount: b.mealCount,
      seasons,
      inSeason: seasons ? seasons.includes(season) : null,
    })
  }

  const freshItems = items.filter((i) => !i.staple)
  const staples = items
    .filter((i) => i.staple)
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.item.localeCompare(b.item))

  const freshGroups = new Map<IngredientCategory, GroceryItem[]>()
  for (const it of freshItems) {
    const arr = freshGroups.get(it.category) ?? []
    arr.push(it)
    freshGroups.set(it.category, arr)
  }
  const fresh = [...freshGroups.entries()]
    .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]))
    .map(([category, list]) => ({
      category,
      items: list.sort((a, b) => a.item.localeCompare(b.item)),
    }))

  const inSeasonNow = freshItems.filter((i) => i.inSeason === true).map((i) => i.item)
  const outOfSeason = freshItems.filter((i) => i.inSeason === false).map((i) => i.item)

  return { season, fresh, staples, inSeasonNow, outOfSeason }
}

function dedupe(extras: string[]): string[] {
  const counts = new Map<string, number>()
  for (const e of extras) counts.set(e, (counts.get(e) ?? 0) + 1)
  return [...counts.entries()].map(([e, n]) => (n > 1 ? `${e} (x${n})` : e))
}

/** "days 1, 3" style note; empty when used on a single day. */
export function reuseNote(item: GroceryItem): string {
  if (item.staple) return item.mealCount > 1 ? `reused in ${item.mealCount} meals` : 'one purchase'
  if (item.days.length > 1) return `days ${item.days.join(', ')} · cook once, reuse`
  return `day ${item.days[0]}`
}
