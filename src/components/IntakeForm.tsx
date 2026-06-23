import { useEffect, useMemo, useState } from 'react'
import {
  ACTIVITY_LEVELS,
  DIETS,
  GOALS,
  PACES,
  PROTOCOLS,
  ProfileSchema,
  type Profile,
} from '../lib/schema'
import { ftInToCm, lbToKg, cmToFtIn, kgToLb, ACTIVITY_LABELS, PACE_LABELS, PROTOCOL_RULES } from '../lib/targets'
import { titleCase } from '../lib/display'
import { useStore } from '../store'

const FORM_KEY = 'mealforge.intakeForm.v1'

interface FormState {
  step: number
  units: 'metric' | 'imperial'
  sex: '' | 'male' | 'female'
  age: string
  heightCm: string
  heightFt: string
  heightIn: string
  currentWeight: string
  goalWeight: string
  activityLevel: '' | Profile['activityLevel']
  goal: '' | Profile['goal']
  pace: Profile['pace']
  protocol: Profile['protocol']
  diet: Profile['diet']
  mealsPerDay: number
  snacks: boolean
  allergies: string
  restrictions: string[]
  dislikes: string
}

const blank: FormState = {
  step: 0,
  units: 'imperial',
  sex: '',
  age: '',
  heightCm: '',
  heightFt: '',
  heightIn: '',
  currentWeight: '',
  goalWeight: '',
  activityLevel: '',
  goal: '',
  pace: 'steady',
  protocol: 'balanced',
  diet: 'omnivore',
  mealsPerDay: 3,
  snacks: true,
  allergies: '',
  restrictions: [],
  dislikes: '',
}

function loadForm(existing: Profile | null): FormState {
  try {
    const raw = localStorage.getItem(FORM_KEY)
    if (raw) return { ...blank, ...(JSON.parse(raw) as Partial<FormState>) }
  } catch {
    /* ignore */
  }
  // Seed from an existing saved profile if the user is editing.
  if (existing) return profileToForm(existing)
  return blank
}

function profileToForm(p: Profile): FormState {
  const { ft, inch } = cmToFtIn(p.heightCm)
  return {
    ...blank,
    units: p.units,
    sex: p.sex,
    age: String(p.age),
    heightCm: String(Math.round(p.heightCm)),
    heightFt: String(ft),
    heightIn: String(inch),
    currentWeight:
      p.units === 'imperial' ? String(Math.round(kgToLb(p.currentWeightKg))) : String(p.currentWeightKg),
    goalWeight:
      p.units === 'imperial' ? String(Math.round(kgToLb(p.goalWeightKg))) : String(p.goalWeightKg),
    activityLevel: p.activityLevel,
    goal: p.goal,
    pace: p.pace,
    protocol: p.protocol,
    diet: p.diet,
    mealsPerDay: p.mealsPerDay,
    snacks: p.snacks,
    allergies: p.allergies.join(', '),
    restrictions: p.restrictions,
    dislikes: p.dislikes.join(', '),
  }
}

const STEPS = ['About you', 'Your goal', 'Protocol', 'Restrictions', 'Meals']

const splitList = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function IntakeForm() {
  const existingProfile = useStore((s) => s.profile)
  const submitProfile = useStore((s) => s.submitProfile)
  const [form, setForm] = useState<FormState>(() => loadForm(existingProfile))
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(form))
    } catch {
      /* ignore */
    }
  }, [form])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const profile = useMemo(() => buildProfile(form), [form])

  const stepErrors = (step: number): string[] => validateStep(form, step)

  function next() {
    const errs = stepErrors(form.step)
    if (errs.length) {
      setErrors(errs)
      return
    }
    setErrors([])
    set('step', Math.min(STEPS.length - 1, form.step + 1))
  }
  function back() {
    setErrors([])
    set('step', Math.max(0, form.step - 1))
  }

  function finish() {
    const errs = STEPS.flatMap((_, i) => stepErrors(i))
    if (errs.length) {
      setErrors(errs)
      return
    }
    const parsed = ProfileSchema.safeParse(profile)
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message))
      return
    }
    try {
      localStorage.removeItem(FORM_KEY)
    } catch {
      /* ignore */
    }
    submitProfile(parsed.data)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Stepper current={form.step} />

      <div className="card p-6 mt-6">
        {form.step === 0 && <StepBody form={form} set={set} />}
        {form.step === 1 && <StepGoal form={form} set={set} />}
        {form.step === 2 && <StepProtocol form={form} set={set} />}
        {form.step === 3 && <StepRestrictions form={form} set={set} />}
        {form.step === 4 && <StepMeals form={form} set={set} />}

        {errors.length > 0 && (
          <ul className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 list-disc list-inside">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button className="btn-ghost" onClick={back} disabled={form.step === 0}>
            Back
          </button>
          {form.step < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={next}>
              Continue
            </button>
          ) : (
            <button className="btn-primary" onClick={finish}>
              Calculate my targets →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type SetFn = <K extends keyof FormState>(key: K, value: FormState[K]) => void

function StepBody({ form, set }: { form: FormState; set: SetFn }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl">About you</h2>
      <UnitsToggle form={form} set={set} />
      <div className="grid grid-cols-2 gap-4">
        <Choice
          label="Sex (for the BMR formula)"
          value={form.sex}
          options={[
            ['male', 'Male'],
            ['female', 'Female'],
          ]}
          onChange={(v) => set('sex', v as FormState['sex'])}
        />
        <div>
          <label className="field-label">Age</label>
          <input
            className="field-input"
            inputMode="numeric"
            value={form.age}
            onChange={(e) => set('age', e.target.value)}
            placeholder="years"
          />
        </div>
      </div>

      <div>
        <label className="field-label">Height</label>
        {form.units === 'imperial' ? (
          <div className="flex gap-3">
            <input
              className="field-input"
              inputMode="numeric"
              value={form.heightFt}
              onChange={(e) => set('heightFt', e.target.value)}
              placeholder="ft"
            />
            <input
              className="field-input"
              inputMode="numeric"
              value={form.heightIn}
              onChange={(e) => set('heightIn', e.target.value)}
              placeholder="in"
            />
          </div>
        ) : (
          <input
            className="field-input"
            inputMode="numeric"
            value={form.heightCm}
            onChange={(e) => set('heightCm', e.target.value)}
            placeholder="cm"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="field-label">Current weight ({form.units === 'imperial' ? 'lb' : 'kg'})</label>
          <input
            className="field-input"
            inputMode="decimal"
            value={form.currentWeight}
            onChange={(e) => set('currentWeight', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Goal weight ({form.units === 'imperial' ? 'lb' : 'kg'})</label>
          <input
            className="field-input"
            inputMode="decimal"
            value={form.goalWeight}
            onChange={(e) => set('goalWeight', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="field-label">Activity level</label>
        <select
          className="field-input"
          value={form.activityLevel}
          onChange={(e) => set('activityLevel', e.target.value as FormState['activityLevel'])}
        >
          <option value="">Select…</option>
          {ACTIVITY_LEVELS.map((a) => (
            <option key={a} value={a}>
              {ACTIVITY_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function StepGoal({ form, set }: { form: FormState; set: SetFn }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl">Your goal</h2>
      <Choice
        label="I want to…"
        value={form.goal}
        options={GOALS.map((g) => [g, titleCase(g) + ' weight'] as [string, string])}
        onChange={(v) => set('goal', v as FormState['goal'])}
      />
      {form.goal !== 'maintain' && (
        <div>
          <label className="field-label">Pace</label>
          <div className="grid grid-cols-3 gap-2">
            {PACES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set('pace', p)}
                className={`rounded-lg px-3 py-2 text-sm ring-1 transition ${
                  form.pace === p
                    ? 'bg-forge-600 text-white ring-forge-600'
                    : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                }`}
              >
                {PACE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-sm text-stone-500">
        We'll turn this into a calorie deficit or surplus on the next screen — and you can edit every
        number.
      </p>
    </div>
  )
}

function StepProtocol({ form, set }: { form: FormState; set: SetFn }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl">Pick a protocol</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {PROTOCOLS.map((p) => {
          const rule = PROTOCOL_RULES[p]
          const active = form.protocol === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => set('protocol', p)}
              className={`text-left rounded-xl p-4 ring-1 transition ${
                active ? 'bg-forge-50 ring-forge-400' : 'bg-white ring-stone-200 hover:bg-stone-50'
              }`}
            >
              <div className="font-medium text-stone-800">{rule.label}</div>
              <div className="text-sm text-stone-500 mt-1">{rule.blurb}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepRestrictions({ form, set }: { form: FormState; set: SetFn }) {
  const toggleRestriction = (r: string) =>
    set(
      'restrictions',
      form.restrictions.includes(r)
        ? form.restrictions.filter((x) => x !== r)
        : [...form.restrictions, r],
    )
  return (
    <div className="space-y-4">
      <h2 className="text-xl">Restrictions</h2>
      <div>
        <label className="field-label">Dietary pattern</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DIETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => set('diet', d)}
              className={`rounded-lg px-3 py-2 text-sm ring-1 transition ${
                form.diet === d
                  ? 'bg-forge-600 text-white ring-forge-600'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {titleCase(d)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="field-label">Religious / ethical</label>
        <div className="flex gap-2">
          {['halal', 'kosher'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRestriction(r)}
              className={`rounded-lg px-3 py-2 text-sm ring-1 transition ${
                form.restrictions.includes(r)
                  ? 'bg-forge-600 text-white ring-forge-600'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {titleCase(r)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="field-label">Allergies (comma-separated — these are treated as absolute)</label>
        <input
          className="field-input"
          value={form.allergies}
          onChange={(e) => set('allergies', e.target.value)}
          placeholder="peanuts, shellfish, gluten"
        />
      </div>
      <div>
        <label className="field-label">Disliked ingredients (comma-separated)</label>
        <input
          className="field-input"
          value={form.dislikes}
          onChange={(e) => set('dislikes', e.target.value)}
          placeholder="mushrooms, cilantro"
        />
      </div>
    </div>
  )
}

function StepMeals({ form, set }: { form: FormState; set: SetFn }) {
  return (
    <div className="space-y-5">
      <h2 className="text-xl">Meals</h2>
      <div>
        <label className="field-label">Meals per day</label>
        <div className="flex gap-2">
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set('mealsPerDay', n)}
              className={`h-10 w-12 rounded-lg text-sm ring-1 transition ${
                form.mealsPerDay === n
                  ? 'bg-forge-600 text-white ring-forge-600'
                  : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-forge-600"
          checked={form.snacks}
          onChange={(e) => set('snacks', e.target.checked)}
        />
        Allow snack slots
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-between text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex-1 flex items-center">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full font-medium ${
              i <= current ? 'bg-forge-600 text-white' : 'bg-stone-200 text-stone-500'
            }`}
          >
            {i + 1}
          </div>
          <span className={`ml-2 hidden sm:inline ${i === current ? 'text-stone-800' : 'text-stone-400'}`}>
            {label}
          </span>
          {i < STEPS.length - 1 && <div className="flex-1 h-px bg-stone-200 mx-2" />}
        </li>
      ))}
    </ol>
  )
}

function UnitsToggle({ form, set }: { form: FormState; set: SetFn }) {
  return (
    <div className="inline-flex rounded-lg ring-1 ring-stone-200 overflow-hidden text-sm">
      {(['imperial', 'metric'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => set('units', u)}
          className={`px-4 py-1.5 ${form.units === u ? 'bg-forge-600 text-white' : 'bg-white text-stone-600'}`}
        >
          {u === 'imperial' ? 'lb / ft' : 'kg / cm'}
        </button>
      ))}
    </div>
  )
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="flex gap-2">
        {options.map(([val, lbl]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm ring-1 transition ${
              value === val
                ? 'bg-forge-600 text-white ring-forge-600'
                : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Build + validate
// ---------------------------------------------------------------------------

function buildProfile(form: FormState): Partial<Profile> {
  const num = (s: string) => {
    const n = parseFloat(s)
    return Number.isFinite(n) ? n : NaN
  }
  const heightCm =
    form.units === 'imperial'
      ? ftInToCm(num(form.heightFt) || 0, num(form.heightIn) || 0)
      : num(form.heightCm)
  const toKg = (s: string) => (form.units === 'imperial' ? lbToKg(num(s)) : num(s))

  return {
    units: form.units,
    sex: form.sex || undefined,
    age: num(form.age),
    heightCm,
    currentWeightKg: toKg(form.currentWeight),
    goalWeightKg: toKg(form.goalWeight),
    activityLevel: form.activityLevel || undefined,
    goal: form.goal || undefined,
    pace: form.pace,
    protocol: form.protocol,
    diet: form.diet,
    mealsPerDay: form.mealsPerDay,
    snacks: form.snacks,
    allergies: splitList(form.allergies),
    restrictions: form.restrictions,
    dislikes: splitList(form.dislikes),
  } as Partial<Profile>
}

function validateStep(form: FormState, step: number): string[] {
  const errs: string[] = []
  const num = (s: string) => parseFloat(s)
  if (step === 0) {
    if (!form.sex) errs.push('Please select a sex (used by the BMR formula).')
    if (!(num(form.age) >= 13 && num(form.age) <= 100)) errs.push('Enter an age between 13 and 100.')
    if (form.units === 'imperial') {
      if (!(num(form.heightFt) > 0)) errs.push('Enter your height in feet.')
    } else if (!(num(form.heightCm) >= 120)) {
      errs.push('Enter a height in cm.')
    }
    if (!(num(form.currentWeight) > 0)) errs.push('Enter your current weight.')
    if (!form.activityLevel) errs.push('Select an activity level.')
  }
  if (step === 1) {
    if (!form.goal) errs.push('Choose a goal.')
    if (form.goal !== 'maintain' && !(num(form.goalWeight) > 0)) errs.push('Enter a goal weight.')
  }
  // steps 2–4 have sensible defaults; nothing required.
  return errs
}
