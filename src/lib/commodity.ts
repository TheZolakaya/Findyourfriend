/**
 * Purchase-unit conversion.
 *
 * Recipes measure in cups / oz / tbsp / counts, but stores sell in
 * commoditized units: eggs by the dozen, ground meat by the pound, tuna by the
 * can, cottage cheese by the tub, peppers by the each. This maps the summed
 * recipe need for an ingredient into "what you actually buy," rounded up to
 * whole purchasable units.
 *
 * Returns null when it can't confidently convert (unknown or compound items
 * like "Zucchini + asparagus") — callers fall back to showing the recipe need.
 */

export interface Qty {
  unit: string
  qty: number
}

interface Commodity {
  match: string[] // any keyword present in the item name (lower-cased)
  buy: string // singular purchase-unit label
  plural?: string // override if not "<buy>s"
  conv: Record<string, number> // normalized recipe unit -> buy-units per 1 recipe unit
  step?: number // round up to multiples of this many buy-units (default 1)
  note?: string // e.g. "(5 oz)" appended after the count
}

// Order matters: more specific keywords first (e.g. "green onion" before "onion").
const COMMODITIES: Commodity[] = [
  // --- proteins -----------------------------------------------------------
  { match: ['ground turkey', 'ground beef', 'ground chicken'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 1, note: '(1 lb pack)' },
  { match: ['chicken breast', 'chicken'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 0.25 },
  { match: ['sirloin', 'filet', 'steak', 'tenderloin'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 0.25 },
  { match: ['cod', 'salmon fillet', 'tilapia', 'haddock', 'white fish', 'fish'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 0.25 },
  { match: ['shrimp'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 0.25 },
  { match: ['scallop'], buy: 'lb', plural: 'lb', conv: { oz: 1 / 16 }, step: 0.25 },
  { match: ['smoked salmon', 'lox'], buy: 'pack', conv: { oz: 1 / 4 }, step: 1, note: '(4 oz)' },
  { match: ['canned tuna', 'tuna', 'canned chicken', 'canned salmon'], buy: 'can', conv: { can: 1, '': 1 }, step: 1, note: '(5 oz)' },
  { match: ['deli turkey', 'deli'], buy: 'pack', conv: { slice: 1 / 8, '': 1 / 8 }, step: 1 },
  { match: ['egg'], buy: 'dozen', plural: 'dozen', conv: { large: 1 / 12, '': 1 / 12 }, step: 1 },
  { match: ['tofu'], buy: 'block', conv: { oz: 1 / 14 }, step: 1, note: '(14 oz)' },

  // --- dairy --------------------------------------------------------------
  { match: ['cottage cheese'], buy: 'container', conv: { cup: 0.5, oz: 1 / 16 }, step: 1, note: '(16 oz)' },
  { match: ['greek yogurt', 'yogurt'], buy: 'container', conv: { cup: 0.25, oz: 1 / 32 }, step: 1, note: '(32 oz tub)' },

  // --- produce ------------------------------------------------------------
  { match: ['green onion'], buy: 'bunch', plural: 'bunches', conv: { stalk: 1 / 6, '': 1 / 6 }, step: 1 },
  { match: ['onion'], buy: 'onion', conv: { tbsp: 1 / 16, cup: 1, medium: 1, '': 1 }, step: 1 },
  { match: ['bell pepper'], buy: 'bell pepper', conv: { cup: 1, large: 1, medium: 1, '': 1 }, step: 1 },
  { match: ['hot pepper'], buy: 'hot pepper', conv: { tbsp: 0.5, cup: 8, '': 1 }, step: 1 },
  { match: ['cucumber'], buy: 'cucumber', conv: { cup: 0.7, large: 1, medium: 1, '': 1 }, step: 1 },
  { match: ['zucchini'], buy: 'zucchini', plural: 'zucchini', conv: { cup: 0.5, medium: 1, '': 1 }, step: 1 },
  { match: ['lemon'], buy: 'lemon', conv: { large: 1, '': 1 }, step: 1 },
  { match: ['lime'], buy: 'lime', conv: { large: 1, '': 1 }, step: 1 },
  { match: ['broccoli'], buy: 'head', plural: 'heads', conv: { cup: 0.25 }, step: 1 },
  { match: ['cauliflower'], buy: 'head', plural: 'heads', conv: { cup: 1 / 6 }, step: 1 },
  { match: ['cabbage'], buy: 'head', plural: 'heads', conv: { cup: 1 / 8 }, step: 1 },
  { match: ['bok choy'], buy: 'head', plural: 'heads', conv: { cup: 1 / 3 }, step: 1 },
  { match: ['asparagus'], buy: 'bunch', plural: 'bunches', conv: { cup: 0.5 }, step: 1 },
  { match: ['spinach'], buy: 'bag', conv: { cup: 0.2 }, step: 1, note: '(5 oz)' },
  { match: ['mushroom'], buy: 'package', conv: { cup: 1 / 3 }, step: 1, note: '(8 oz)' },
  { match: ['celery'], buy: 'bunch', plural: 'bunches', conv: { stalk: 1 / 8, '': 1 / 8 }, step: 1 },
  { match: ['radish'], buy: 'bunch', plural: 'bunches', conv: { '': 1 / 8 }, step: 1 },
  { match: ['bean sprout'], buy: 'bag', conv: { cup: 0.25 }, step: 1 },
  { match: ['sauerkraut'], buy: 'jar', conv: { cup: 1, '': 1 }, step: 1 },
  { match: ['lettuce', 'romaine', 'arugula'], buy: 'head', plural: 'heads', conv: { large: 1 / 8, cup: 0.25, '': 1 / 8 }, step: 1 },
  { match: ['cilantro', 'parsley', 'dill', 'basil', 'mint'], buy: 'bunch', plural: 'bunches', conv: { tbsp: 1 / 12, cup: 1, '': 1 }, step: 1 },
  { match: ['garlic'], buy: 'head', plural: 'heads', conv: { clove: 1 / 10, tbsp: 1 / 6, '': 1 / 10 }, step: 1 },
]

function normUnit(u: string): string {
  return u.toLowerCase().trim().replace(/\.$/, '').replace(/s$/, '')
}

function isCompound(itemLower: string): boolean {
  if (itemLower.includes('+')) return true
  if (/\bselect\b|\bmixed\b|dipper/.test(itemLower)) return true
  if ((itemLower.match(/,/g) ?? []).length >= 2) return true
  return false
}

function ceilTo(x: number, step: number): number {
  const n = Math.ceil(x / step - 1e-9) * step
  return Number(n.toFixed(2))
}

function pluralize(c: Commodity, qty: number): string {
  if (qty === 1) return c.buy
  return c.plural ?? (c.buy.endsWith('s') ? c.buy : `${c.buy}s`)
}

const fmt = (n: number): string => Number(n.toFixed(2)).toString()

/**
 * Convert the summed recipe need for one ingredient into a store-purchase
 * string ("2 dozen", "1 lb (1 lb pack)", "2 bell peppers"). Null if unknown.
 */
export function purchaseFor(item: string, quantities: Qty[]): string | null {
  const itemLower = item.toLowerCase()
  if (isCompound(itemLower)) return null

  const c = COMMODITIES.find((com) => com.match.some((m) => itemLower.includes(m)))
  if (!c) return null

  let buyUnits = 0
  let recognized = false
  for (const q of quantities) {
    const factor = c.conv[normUnit(q.unit)]
    if (factor !== undefined) {
      buyUnits += q.qty * factor
      recognized = true
    }
  }
  if (!recognized || buyUnits <= 0) return null

  const rounded = ceilTo(buyUnits, c.step ?? 1)
  return `${fmt(rounded)} ${pluralize(c, rounded)}${c.note ? ` ${c.note}` : ''}`
}
