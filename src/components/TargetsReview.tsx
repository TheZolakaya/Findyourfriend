import { useState } from 'react'
import { useStore } from '../store'
import type { Targets } from '../lib/schema'
import { weightDisplay, heightDisplay, titleCase } from '../lib/display'

export function TargetsReview() {
  const profile = useStore((s) => s.profile)
  const targets = useStore((s) => s.targets)
  const setTargetField = useStore((s) => s.setTargetField)
  const setTolerance = useStore((s) => s.setTolerance)
  const resetTargets = useStore((s) => s.resetTargets)
  const planDays = useStore((s) => s.planDays)
  const setPlanDays = useStore((s) => s.setPlanDays)
  const varietyHint = useStore((s) => s.varietyHint)
  const setVarietyHint = useStore((s) => s.setVarietyHint)
  const useLive = useStore((s) => s.useLive)
  const setUseLive = useStore((s) => s.setUseLive)
  const health = useStore((s) => s.health)
  const generate = useStore((s) => s.generate)
  const editProfile = useStore((s) => s.editProfile)
  const [showMath, setShowMath] = useState(false)

  if (!profile || !targets) return null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl">Your daily targets</h1>
          <p className="text-stone-500 mt-1">
            {titleCase(profile.protocol)} · {titleCase(profile.goal)} weight · {profile.diet} ·{' '}
            {heightDisplay(profile.heightCm, profile.units)},{' '}
            {weightDisplay(profile.currentWeightKg, profile.units)} →{' '}
            {weightDisplay(profile.goalWeightKg, profile.units)}
          </p>
        </div>
        <button className="btn-ghost no-print" onClick={editProfile}>
          Edit details
        </button>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg">
            Targets{' '}
            <span
              className={`ml-2 align-middle text-xs px-2 py-0.5 rounded-full ${
                targets.source === 'manual'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-stone-100 text-stone-500'
              }`}
            >
              {targets.source === 'manual' ? 'edited' : 'computed'}
            </span>
          </h2>
          {targets.source === 'manual' && (
            <button className="text-sm text-forge-700 hover:underline" onClick={resetTargets}>
              Reset to computed
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <TargetField label="Calories" unit="kcal" value={targets.calories} onChange={(v) => setTargetField('calories', v)} />
          <TargetField label="Protein" unit="g" value={targets.protein_g} onChange={(v) => setTargetField('protein_g', v)} />
          <TargetField label="Carbs" unit="g" value={targets.carbs_g} onChange={(v) => setTargetField('carbs_g', v)} />
          <TargetField label="Fat" unit="g" value={targets.fat_g} onChange={(v) => setTargetField('fat_g', v)} />
        </div>

        <MacroBar targets={targets} />

        <button
          className="mt-4 text-sm text-forge-700 hover:underline"
          onClick={() => setShowMath((v) => !v)}
        >
          {showMath ? 'Hide the math' : 'Show the math'}
        </button>
        {showMath && (
          <ol className="mt-3 space-y-1 text-sm text-stone-600 list-decimal list-inside bg-stone-50 rounded-lg p-4">
            {targets.breakdown.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="card p-6 space-y-5">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="field-label">Plan length: {planDays} days</label>
            <input
              type="range"
              min={1}
              max={14}
              value={planDays}
              onChange={(e) => setPlanDays(Number(e.target.value))}
              className="w-full accent-forge-600"
            />
          </div>
          <div>
            <label className="field-label">Tolerance: ±{targets.tolerance_pct}%</label>
            <input
              type="range"
              min={5}
              max={25}
              value={targets.tolerance_pct}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="w-full accent-forge-600"
            />
          </div>
        </div>
        <div>
          <label className="field-label">Variety guidance (optional)</label>
          <input
            className="field-input"
            value={varietyHint}
            onChange={(e) => setVarietyHint(e.target.value)}
            placeholder="e.g. quick breakfasts, Mediterranean dinners, batch-cook lunches"
          />
        </div>

        <LiveToggle useLive={useLive} setUseLive={setUseLive} hasKey={health.hasKey} model={health.model} />

        <button className="btn-primary w-full text-base py-3" onClick={generate}>
          Generate my {planDays}-day plan →
        </button>
      </div>
    </div>
  )
}

function TargetField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="field-label">
        {label} <span className="text-stone-400">({unit})</span>
      </label>
      <input
        className="field-input text-lg font-medium"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isFinite(n) ? n : 0)
        }}
      />
    </div>
  )
}

function MacroBar({ targets }: { targets: Targets }) {
  const p = targets.protein_g * 4
  const c = targets.carbs_g * 4
  const f = targets.fat_g * 9
  const tot = p + c + f || 1
  const seg = (n: number) => `${(n / tot) * 100}%`
  return (
    <div className="mt-5">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        <div className="bg-forge-500" style={{ width: seg(p) }} title="Protein" />
        <div className="bg-emerald-400" style={{ width: seg(c) }} title="Carbs" />
        <div className="bg-amber-400" style={{ width: seg(f) }} title="Fat" />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-stone-500">
        <span><span className="inline-block h-2 w-2 rounded-full bg-forge-500 mr-1" />Protein {Math.round((p / tot) * 100)}%</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1" />Carbs {Math.round((c / tot) * 100)}%</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1" />Fat {Math.round((f / tot) * 100)}%</span>
      </div>
    </div>
  )
}

function LiveToggle({
  useLive,
  setUseLive,
  hasKey,
  model,
}: {
  useLive: boolean
  setUseLive: (b: boolean) => void
  hasKey: boolean
  model: string
}) {
  return (
    <div className="rounded-lg bg-stone-50 p-4 text-sm">
      {hasKey ? (
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-4 w-4 accent-forge-600"
            checked={useLive}
            onChange={(e) => setUseLive(e.target.checked)}
          />
          <span>
            Use live AI generation ({model}).{' '}
            <span className="text-stone-500">Off uses instant sample data.</span>
          </span>
        </label>
      ) : (
        <p className="text-stone-500">
          Showing <strong>instant sample plans</strong>. Live AI-generated recipes can be switched on
          later.
        </p>
      )}
    </div>
  )
}
