import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { DayCard } from './DayCard'
import { ShoppingListView } from './ShoppingListView'
import { validatePlan } from '../lib/validate'
import { downloadText, planToMarkdown } from '../lib/export'

type Tab = 'plan' | 'shopping'

export function PlanView() {
  const profile = useStore((s) => s.profile)
  const targets = useStore((s) => s.targets)
  const plan = useStore((s) => s.plan)
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const busyKey = useStore((s) => s.busyKey)
  const name = useStore((s) => s.currentPlanName)
  const saveCurrent = useStore((s) => s.saveCurrent)
  const generate = useStore((s) => s.generate)
  const goto = useStore((s) => s.goto)
  const [tab, setTab] = useState<Tab>('plan')
  const [saved, setSaved] = useState(false)

  const generatingAll = status === 'generating' && !busyKey

  const validation = useMemo(
    () => (plan && targets && profile ? validatePlan(plan, targets, profile) : null),
    [plan, targets, profile],
  )

  if (!profile || !targets) return null

  if (generatingAll) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-forge-200 border-t-forge-600" />
        <p className="mt-4 text-stone-600">Forging your plan…</p>
        <p className="text-sm text-stone-400">Hitting your targets while respecting every restriction.</p>
      </div>
    )
  }

  if (error && !plan) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-red-600 font-medium">Couldn't generate the plan.</p>
        <p className="mt-1 text-sm text-stone-500">{error}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button className="btn-ghost" onClick={() => goto('review')}>
            Back to targets
          </button>
          <button className="btn-primary" onClick={generate}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!plan) return null

  const onSave = () => {
    saveCurrent()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  const onExport = () =>
    downloadText(`${slug(name)}.md`, planToMarkdown(name || 'Meal plan', profile, targets, plan))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <NameField />
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => goto('review')}>
            ← Targets
          </button>
          <button className="btn-ghost" onClick={onExport}>
            ⬇ Markdown
          </button>
          <button className="btn-ghost" onClick={() => window.print()}>
            🖨 Print
          </button>
          <button className="btn-primary" onClick={onSave}>
            {saved ? 'Saved ✓' : 'Save plan'}
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {validation && !validation.ok && (
        <ValidationBanner validation={validation} />
      )}

      <div className="no-print flex gap-1 rounded-lg bg-stone-100 p-1 w-fit">
        {(['plan', 'shopping'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500'
            }`}
          >
            {t === 'plan' ? 'Meal plan' : 'Shopping list'}
          </button>
        ))}
      </div>

      {tab === 'plan' ? (
        <div className="space-y-4">
          {plan.days.map((day) => (
            <DayCard key={day.day} day={day} targets={targets} />
          ))}
        </div>
      ) : (
        <ShoppingListView plan={plan} />
      )}
    </div>
  )
}

function NameField() {
  const name = useStore((s) => s.currentPlanName)
  const set = (v: string) => useStore.setState({ currentPlanName: v })
  return (
    <input
      value={name}
      onChange={(e) => set(e.target.value)}
      className="text-2xl font-display bg-transparent outline-none border-b border-transparent focus:border-forge-300 max-w-full"
      aria-label="Plan name"
    />
  )
}

function ValidationBanner({
  validation,
}: {
  validation: NonNullable<ReturnType<typeof validatePlan>>
}) {
  const ex = validation.exclusionViolations
  return (
    <div className="no-print rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
      <p className="font-medium">Heads up — a few days didn't fully validate:</p>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        {ex.length > 0 && (
          <li>
            Possible restricted ingredient{ex.length > 1 ? 's' : ''}:{' '}
            {ex.slice(0, 4).map((v) => `"${v.item}" (day ${v.day})`).join(', ')}
            {ex.length > 4 ? '…' : ''}. Try swapping or regenerating those meals.
          </li>
        )}
        {validation.failingDays.length > 0 && (
          <li>Days off target: {validation.failingDays.join(', ')}. Use “Regenerate day”.</li>
        )}
      </ul>
    </div>
  )
}

const slug = (s: string): string =>
  (s || 'meal-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meal-plan'
