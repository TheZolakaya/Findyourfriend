import { z } from 'zod'
import { ProfileSchema, SavedPlanSchema, type Profile, type SavedPlan } from './schema'

/**
 * localStorage persistence. Everything read back is re-validated with zod so a
 * stale or corrupt entry can never crash the app — it's simply ignored.
 */

const PROFILE_KEY = 'mealforge.profile.v1'
const DRAFT_KEY = 'mealforge.intakeDraft.v1'
const PLANS_KEY = 'mealforge.plans.v1'

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — non-fatal */
  }
}

// --- Intake draft (resumable form; partial profile) -------------------------

const DraftSchema = ProfileSchema.partial().extend({
  _step: z.number().int().optional(),
})
export type IntakeDraft = z.infer<typeof DraftSchema>

export function loadDraft(): IntakeDraft | null {
  const parsed = DraftSchema.safeParse(readJson(DRAFT_KEY))
  return parsed.success ? parsed.data : null
}
export function saveDraft(draft: IntakeDraft): void {
  writeJson(DRAFT_KEY, draft)
}
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

// --- Completed profile ------------------------------------------------------

export function loadProfile(): Profile | null {
  const parsed = ProfileSchema.safeParse(readJson(PROFILE_KEY))
  return parsed.success ? parsed.data : null
}
export function saveProfile(profile: Profile): void {
  writeJson(PROFILE_KEY, profile)
}

// --- Saved plans ------------------------------------------------------------

export function loadPlans(): SavedPlan[] {
  const arr = readJson(PLANS_KEY)
  if (!Array.isArray(arr)) return []
  return arr.flatMap((p) => {
    const parsed = SavedPlanSchema.safeParse(p)
    return parsed.success ? [parsed.data] : []
  })
}

export function savePlan(plan: SavedPlan): SavedPlan[] {
  const plans = loadPlans().filter((p) => p.id !== plan.id)
  plans.unshift(plan)
  writeJson(PLANS_KEY, plans)
  return plans
}

export function deletePlan(id: string): SavedPlan[] {
  const plans = loadPlans().filter((p) => p.id !== id)
  writeJson(PLANS_KEY, plans)
  return plans
}

export function newId(): string {
  return `plan_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

// --- Pantry (staples the user already owns) ---------------------------------
// Stored as lower-cased item names so they persist across plans.

const PANTRY_KEY = 'mealforge.pantry.v1'

export function pantryKey(item: string): string {
  return item.trim().toLowerCase()
}

export function loadPantry(): string[] {
  const arr = readJson(PANTRY_KEY)
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
}

export function togglePantry(item: string): string[] {
  const key = pantryKey(item)
  const owned = new Set(loadPantry())
  if (owned.has(key)) owned.delete(key)
  else owned.add(key)
  const next = [...owned]
  writeJson(PANTRY_KEY, next)
  return next
}
