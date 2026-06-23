import { create } from 'zustand'
import type { MealSlot, Plan, Profile, SavedPlan, Targets } from './lib/schema'
import { MEAL_SLOTS } from './lib/schema'
import { computeTargets } from './lib/targets'
import {
  fetchHealth,
  liveService,
  mockService,
  type ApiHealth,
  type GenerateService,
} from './lib/generate'
import {
  deletePlan as deletePlanStorage,
  loadPlans,
  loadProfile,
  newId,
  saveProfile,
  savePlan as savePlanStorage,
} from './lib/storage'

export type View = 'intake' | 'review' | 'plan' | 'saved'
export type Status = 'idle' | 'generating' | 'swapping' | 'error'

interface AppState {
  view: View
  profile: Profile | null
  targets: Targets | null
  plan: Plan | null
  planDays: number
  varietyHint: string
  currentPlanId: string | null
  currentPlanName: string

  savedPlans: SavedPlan[]

  health: ApiHealth
  useLive: boolean
  status: Status
  busyKey: string | null // e.g. "swap:1:lunch" or "day:2"
  error: string | null

  // lifecycle
  init: () => Promise<void>
  service: () => GenerateService

  // navigation
  goto: (view: View) => void
  editProfile: () => void

  // intake -> targets
  submitProfile: (profile: Profile) => void

  // targets editing
  setTargetField: (field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g', value: number) => void
  setTolerance: (pct: number) => void
  resetTargets: () => void

  // generation
  setPlanDays: (n: number) => void
  setVarietyHint: (s: string) => void
  setUseLive: (b: boolean) => void
  generate: () => Promise<void>
  regenerateDay: (day: number) => Promise<void>
  swapMeal: (day: number, slot: MealSlot, title: string) => Promise<void>

  // saved plans
  saveCurrent: (name?: string) => void
  loadSaved: (id: string) => void
  removeSaved: (id: string) => void
}

export const useStore = create<AppState>((set, get) => ({
  view: 'intake',
  profile: null,
  targets: null,
  plan: null,
  planDays: 3,
  varietyHint: '',
  currentPlanId: null,
  currentPlanName: '',
  savedPlans: [],
  health: { hasKey: false, model: '' },
  useLive: false,
  status: 'idle',
  busyKey: null,
  error: null,

  async init() {
    const savedPlans = loadPlans()
    const profile = loadProfile()
    set({ savedPlans })
    if (profile) {
      set({ profile, targets: computeTargets(profile), view: 'review' })
    }
    const health = await fetchHealth()
    set({ health, useLive: health.hasKey })
  },

  service() {
    const { useLive, health } = get()
    return useLive && health.hasKey ? liveService : mockService
  },

  goto(view) {
    set({ view })
  },

  editProfile() {
    set({ view: 'intake' })
  },

  submitProfile(profile) {
    saveProfile(profile)
    set({
      profile,
      targets: computeTargets(profile),
      view: 'review',
      plan: null,
      currentPlanId: null,
      currentPlanName: '',
      error: null,
    })
  },

  setTargetField(field, value) {
    const t = get().targets
    if (!t) return
    set({ targets: { ...t, [field]: value, source: 'manual' } })
  },

  setTolerance(pct) {
    const t = get().targets
    if (!t) return
    set({ targets: { ...t, tolerance_pct: pct } })
  },

  resetTargets() {
    const p = get().profile
    if (!p) return
    set({ targets: computeTargets(p, get().targets?.tolerance_pct ?? 10) })
  },

  setPlanDays(n) {
    set({ planDays: Math.min(14, Math.max(1, n)) })
  },
  setVarietyHint(s) {
    set({ varietyHint: s })
  },
  setUseLive(b) {
    set({ useLive: b })
  },

  async generate() {
    const { profile, targets, planDays, varietyHint } = get()
    if (!profile || !targets) return
    set({ status: 'generating', error: null, view: 'plan' })
    try {
      const plan = await get().service().generatePlan({ profile, targets, days: planDays, varietyHint })
      const id = get().currentPlanId ?? newId()
      const name = get().currentPlanName || defaultName(profile)
      set({ plan, status: 'idle', currentPlanId: id, currentPlanName: name })
    } catch (e) {
      set({ status: 'error', error: errMsg(e) })
    }
  },

  async regenerateDay(day) {
    const { profile, targets, plan, varietyHint } = get()
    if (!profile || !targets || !plan) return
    set({ status: 'generating', busyKey: `day:${day}`, error: null })
    try {
      const fresh = await get()
        .service()
        .generatePlan({ profile, targets, days: 1, varietyHint })
      const newDay = { ...fresh.days[0], day }
      const days = plan.days.map((d) => (d.day === day ? newDay : d))
      set({ plan: { days }, status: 'idle', busyKey: null })
    } catch (e) {
      set({ status: 'error', busyKey: null, error: errMsg(e) })
    }
  },

  async swapMeal(day, slot, title) {
    const { profile, targets, plan } = get()
    if (!profile || !targets || !plan) return
    const dayPlan = plan.days.find((d) => d.day === day)
    const meal = dayPlan?.meals.find((m) => m.slot === slot && m.title === title)
    if (!dayPlan || !meal) return
    const otherTitlesToday = dayPlan.meals.filter((m) => m !== meal).map((m) => m.title)
    set({ status: 'swapping', busyKey: `swap:${day}:${slot}:${title}`, error: null })
    try {
      const replacement = await get()
        .service()
        .swapMeal({ profile, targets, day, meal, otherTitlesToday })
      const days = plan.days.map((d) =>
        d.day === day
          ? { ...d, meals: d.meals.map((m) => (m === meal ? replacement : m)) }
          : d,
      )
      set({ plan: { days }, status: 'idle', busyKey: null })
    } catch (e) {
      set({ status: 'error', busyKey: null, error: errMsg(e) })
    }
  },

  saveCurrent(name) {
    const { profile, targets, plan, currentPlanId } = get()
    if (!profile || !targets || !plan) return
    const id = currentPlanId ?? newId()
    const record: SavedPlan = {
      id,
      name: name || get().currentPlanName || defaultName(profile),
      createdAt: new Date().toISOString(),
      profile,
      targets,
      plan,
    }
    const savedPlans = savePlanStorage(record)
    set({ savedPlans, currentPlanId: id, currentPlanName: record.name })
  },

  loadSaved(id) {
    const rec = get().savedPlans.find((p) => p.id === id)
    if (!rec) return
    set({
      profile: rec.profile,
      targets: rec.targets,
      plan: rec.plan,
      planDays: rec.plan.days.length,
      currentPlanId: rec.id,
      currentPlanName: rec.name,
      view: 'plan',
      status: 'idle',
      error: null,
    })
  },

  removeSaved(id) {
    const savedPlans = deletePlanStorage(id)
    set({ savedPlans })
    if (get().currentPlanId === id) set({ currentPlanId: null })
  },
}))

// Order meals within a day consistently for display.
export function orderedMeals<T extends { slot: MealSlot }>(meals: T[]): T[] {
  return [...meals].sort((a, b) => MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
}

function defaultName(profile: Profile): string {
  const proto = profile.protocol.replace(/_/g, ' ')
  return `${proto} plan`
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}
