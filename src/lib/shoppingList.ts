import type { IngredientCategory, Plan, ShoppingItem } from './schema'
import { INGREDIENT_CATEGORIES } from './schema'

/**
 * Consolidate every ingredient across the plan into one shopping list,
 * grouped by category with quantities summed where units allow.
 *
 * Amount strings are free-form ("2 cups", "100 g", "1 medium"), so summing is
 * best-effort: same item + same unit are added; otherwise amounts are listed
 * together ("2 cups + 1 tbsp"). This is deterministic, no AI.
 */

interface ParsedAmount {
  qty: number | null
  unit: string
  raw: string
}

const NUM = '(\\d+\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?)'
const AMOUNT_RE = new RegExp(`^\\s*${NUM}\\s*([a-zA-Z%\\.]*)\\s*(.*)$`)

function parseFraction(s: string): number {
  if (s.includes('/')) {
    const [a, b] = s.split('/').map((x) => parseFloat(x.trim()))
    return b ? a / b : a
  }
  return parseFloat(s)
}

export function parseAmount(raw: string): ParsedAmount {
  const m = raw.match(AMOUNT_RE)
  if (!m) return { qty: null, unit: '', raw: raw.trim() }
  const qty = parseFraction(m[1])
  const unit = (m[2] || '').toLowerCase().replace(/\.$/, '')
  return { qty: Number.isFinite(qty) ? qty : null, unit, raw: raw.trim() }
}

function formatQty(qty: number): string {
  // Trim trailing zeros: 2.0 -> "2", 1.50 -> "1.5"
  return Number(qty.toFixed(2)).toString()
}

interface Bucket {
  item: string // display name (first seen casing)
  category: IngredientCategory
  // amounts keyed by unit so same-unit quantities sum; null-qty/raw kept aside
  byUnit: Map<string, number>
  extras: string[]
}

const categoryOrder = (c: IngredientCategory): number => INGREDIENT_CATEGORIES.indexOf(c)

export function buildShoppingList(plan: Plan): ShoppingItem[] {
  const buckets = new Map<string, Bucket>()

  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        const key = `${ing.category}::${ing.item.trim().toLowerCase()}`
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = {
            item: ing.item.trim(),
            category: ing.category,
            byUnit: new Map(),
            extras: [],
          }
          buckets.set(key, bucket)
        }
        const parsed = parseAmount(ing.amount)
        if (parsed.qty !== null) {
          bucket.byUnit.set(parsed.unit, (bucket.byUnit.get(parsed.unit) ?? 0) + parsed.qty)
        } else if (parsed.raw) {
          bucket.extras.push(parsed.raw)
        }
      }
    }
  }

  const items: ShoppingItem[] = []
  for (const bucket of buckets.values()) {
    const parts: string[] = []
    for (const [unit, qty] of bucket.byUnit) {
      parts.push(unit ? `${formatQty(qty)} ${unit}` : formatQty(qty))
    }
    parts.push(...dedupeExtras(bucket.extras))
    items.push({
      category: bucket.category,
      item: bucket.item,
      totalAmount: parts.join(' + ') || '—',
    })
  }

  items.sort(
    (a, b) =>
      categoryOrder(a.category) - categoryOrder(b.category) ||
      a.item.localeCompare(b.item),
  )
  return items
}

function dedupeExtras(extras: string[]): string[] {
  const counts = new Map<string, number>()
  for (const e of extras) counts.set(e, (counts.get(e) ?? 0) + 1)
  return [...counts.entries()].map(([e, n]) => (n > 1 ? `${e} (x${n})` : e))
}

/** Group a flat shopping list by category, in canonical category order. */
export function groupByCategory(
  items: ShoppingItem[],
): { category: IngredientCategory; items: ShoppingItem[] }[] {
  const groups = new Map<IngredientCategory, ShoppingItem[]>()
  for (const it of items) {
    const arr = groups.get(it.category) ?? []
    arr.push(it)
    groups.set(it.category, arr)
  }
  return [...groups.entries()]
    .sort((a, b) => categoryOrder(a[0]) - categoryOrder(b[0]))
    .map(([category, items]) => ({ category, items }))
}
