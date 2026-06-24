import {
  GeneratedMealSchema,
  GeneratedPlanSchema,
  type Meal,
  type Plan,
  type Profile,
  type Targets,
} from './schema'
import { makeMockMeal, makeMockPlan } from './fixtures'
import { assemblePlan, assembleSwap, hasLibrary } from './library'

/**
 * The generation service is hidden behind an interface so the UI can run on
 * fixtures (mock) and switch to the live Anthropic-backed endpoint without any
 * component change. The live impl talks to the local Express proxy, which holds
 * the API key — the browser never sees it.
 */

export interface GenerateRequest {
  profile: Profile
  targets: Targets
  days: number
  varietyHint?: string
}

export interface SwapRequest {
  profile: Profile
  targets: Targets
  day: number
  meal: Meal
  otherTitlesToday: string[]
}

export interface GenerateService {
  readonly kind: 'mock' | 'live'
  generatePlan(req: GenerateRequest): Promise<Plan>
  swapMeal(req: SwapRequest): Promise<Meal>
}

// --- Mock (fixtures) --------------------------------------------------------

export const mockService: GenerateService = {
  kind: 'mock',
  async generatePlan({ profile, targets, days }) {
    // Tiny delay so the UI's loading states are exercised.
    await delay(350)
    // Prefer the curated recipe library when this protocol has one (real
    // recipes); otherwise fall back to generic placeholder plans.
    if (hasLibrary(profile.protocol)) return assemblePlan(profile, targets, days)
    return makeMockPlan(profile, targets, days)
  },
  async swapMeal({ profile, targets, meal }) {
    await delay(250)
    if (hasLibrary(profile.protocol)) return assembleSwap(profile, targets, meal)
    return makeMockMeal(profile, targets, meal)
  },
}

// --- Live (Anthropic via local server) --------------------------------------

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`)
  }
  return data as T
}

export const liveService: GenerateService = {
  kind: 'live',
  async generatePlan(req) {
    const data = await postJson<unknown>('/api/generate', req)
    return GeneratedPlanSchema.parse(data)
  },
  async swapMeal(req) {
    const data = await postJson<unknown>('/api/swap', req)
    return GeneratedMealSchema.parse(data).meal
  },
}

export interface ApiHealth {
  hasKey: boolean
  model: string
}

export async function fetchHealth(): Promise<ApiHealth> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { hasKey: false, model: '' }
    return (await res.json()) as ApiHealth
  } catch {
    return { hasKey: false, model: '' }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
