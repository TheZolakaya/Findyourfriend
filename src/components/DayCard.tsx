import { useState } from 'react'
import type { DayPlan, Meal, Targets } from '../lib/schema'
import { checkDayMacros } from '../lib/validate'
import { SLOT_EMOJI, SLOT_LABEL } from '../lib/display'
import { orderedMeals, useStore } from '../store'
import { MacroChips, RecipeModal } from './RecipeModal'

export function DayCard({ day, targets }: { day: DayPlan; targets: Targets }) {
  const swapMeal = useStore((s) => s.swapMeal)
  const regenerateDay = useStore((s) => s.regenerateDay)
  const busyKey = useStore((s) => s.busyKey)
  const status = useStore((s) => s.status)
  const [open, setOpen] = useState<Meal | null>(null)

  const check = checkDayMacros(day, targets)
  const dayBusy = busyKey === `day:${day.day}`

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-stone-50 px-5 py-3 border-b border-stone-200">
        <div className="flex items-center gap-3">
          <h3 className="text-lg">Day {day.day}</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              check.withinTolerance ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}
            title={`${Math.round(check.totals.kcal)} kcal vs ${targets.calories} target`}
          >
            {Math.round(check.totals.kcal)} kcal{' '}
            {check.withinTolerance ? '· on target' : `· ${signed(check.deltas.kcal)}%`}
          </span>
        </div>
        <button
          className="btn-ghost no-print text-xs"
          onClick={() => regenerateDay(day.day)}
          disabled={status !== 'idle'}
        >
          {dayBusy ? 'Regenerating…' : '↻ Regenerate day'}
        </button>
      </div>

      <div className="divide-y divide-stone-100">
        {orderedMeals(day.meals).map((meal) => (
          <MealRow
            key={`${meal.slot}:${meal.title}`}
            meal={meal}
            onView={() => setOpen(meal)}
            onSwap={() => swapMeal(day.day, meal.slot, meal.title)}
            busy={busyKey === `swap:${day.day}:${meal.slot}:${meal.title}`}
            disabled={status !== 'idle'}
          />
        ))}
      </div>

      {open && <RecipeModal meal={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function MealRow({
  meal,
  onView,
  onSwap,
  busy,
  disabled,
}: {
  meal: Meal
  onView: () => void
  onSwap: () => void
  busy: boolean
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="text-2xl" aria-hidden>
        {SLOT_EMOJI[meal.slot]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-stone-400">{SLOT_LABEL[meal.slot]}</div>
        <button className="text-left font-medium text-stone-800 hover:text-forge-700" onClick={onView}>
          {meal.title}
        </button>
        <MacroChips meal={meal} className="mt-1.5" />
      </div>
      <div className="no-print flex shrink-0 flex-col gap-1.5">
        <button className="btn-ghost text-xs" onClick={onView}>
          Recipe
        </button>
        {meal.swappable && (
          <button className="btn-ghost text-xs" onClick={onSwap} disabled={disabled}>
            {busy ? 'Swapping…' : '⇄ Swap'}
          </button>
        )}
      </div>
    </div>
  )
}

const signed = (n: number): string => `${n > 0 ? '+' : ''}${Math.round(n)}`
