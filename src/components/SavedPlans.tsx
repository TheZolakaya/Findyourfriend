import { useStore } from '../store'
import { titleCase } from '../lib/display'

export function SavedPlans() {
  const plans = useStore((s) => s.savedPlans)
  const loadSaved = useStore((s) => s.loadSaved)
  const removeSaved = useStore((s) => s.removeSaved)
  const goto = useStore((s) => s.goto)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Saved plans</h1>
        <button className="btn-primary" onClick={() => goto('intake')}>
          + New plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-stone-500">
          <p>No saved plans yet.</p>
          <p className="text-sm mt-1">Generate a plan and hit “Save plan” to keep it here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="card flex items-center justify-between p-4">
              <div>
                <button
                  className="font-medium text-stone-800 hover:text-forge-700"
                  onClick={() => loadSaved(p.id)}
                >
                  {p.name}
                </button>
                <div className="text-sm text-stone-500">
                  {p.plan.days.length} days · {titleCase(p.profile.protocol)} ·{' '}
                  {p.targets.calories} kcal · {new Date(p.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => loadSaved(p.id)}>
                  Open
                </button>
                <button
                  className="btn-ghost text-sm text-red-600"
                  onClick={() => removeSaved(p.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
