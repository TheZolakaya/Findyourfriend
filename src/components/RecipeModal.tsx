import { useEffect } from 'react'
import type { Meal } from '../lib/schema'
import { SLOT_EMOJI, SLOT_LABEL } from '../lib/display'

export function RecipeModal({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-stone-400">
              {SLOT_EMOJI[meal.slot]} {SLOT_LABEL[meal.slot]}
            </div>
            <h2 className="text-2xl mt-1">{meal.title}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <MacroChips meal={meal} className="mt-3" />
        <p className="mt-2 text-sm text-stone-500">Serves {meal.servings}</p>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Ingredients
        </h3>
        <ul className="mt-2 space-y-1 text-sm">
          {meal.ingredients.map((ing, i) => (
            <li key={i} className="flex justify-between border-b border-stone-100 py-1">
              <span>{ing.item}</span>
              <span className="text-stone-500">{ing.amount}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-stone-500">Method</h3>
        <ol className="mt-2 space-y-2 text-sm list-decimal list-inside">
          {meal.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function MacroChips({ meal, className = '' }: { meal: Meal; className?: string }) {
  const chip = 'rounded-full px-2.5 py-0.5 text-xs font-medium'
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <span className={`${chip} bg-stone-100 text-stone-700`}>{meal.macros.kcal} kcal</span>
      <span className={`${chip} bg-forge-100 text-forge-800`}>P {meal.macros.protein_g}g</span>
      <span className={`${chip} bg-emerald-100 text-emerald-800`}>C {meal.macros.carbs_g}g</span>
      <span className={`${chip} bg-amber-100 text-amber-800`}>F {meal.macros.fat_g}g</span>
    </div>
  )
}
