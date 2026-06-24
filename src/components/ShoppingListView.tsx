import { useMemo, useState } from 'react'
import type { Plan } from '../lib/schema'
import { buildGroceryList, reuseNote, SEASON_LABEL, type GroceryItem } from '../lib/grocery'
import { loadPantry, pantryKey, togglePantry } from '../lib/storage'
import { titleCase } from '../lib/display'

export function ShoppingListView({ plan }: { plan: Plan }) {
  const list = useMemo(() => buildGroceryList(plan), [plan])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [pantry, setPantry] = useState<string[]>(() => loadPantry())

  const owned = useMemo(() => new Set(pantry), [pantry])
  const toggleCheck = (key: string) => setChecked((c) => ({ ...c, [key]: !c[key] }))
  const toggleOwned = (item: string) => setPantry(togglePantry(item))

  const freshCount = list.fresh.reduce((n, g) => n + g.items.length, 0)
  const staplesToBuy = list.staples.filter((s) => !owned.has(pantryKey(s.item)))

  return (
    <div className="space-y-5">
      {list.inSeasonNow.length > 0 && (
        <div className="card p-4 text-sm">
          <span className="font-medium text-forge-700">In season now ({SEASON_LABEL[list.season]}):</span>{' '}
          <span className="text-stone-600">{unique(list.inSeasonNow).join(', ')}</span>
          {list.outOfSeason.length > 0 && (
            <div className="mt-1 text-stone-400">
              Less in-season: {unique(list.outOfSeason).join(', ')} — fine to buy, just not at peak.
            </div>
          )}
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl">Fresh — buy for this week</h2>
          <span className="text-sm text-stone-500">{freshCount} items</span>
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-6">
          {list.fresh.map((group) => (
            <div key={group.category} className="break-inside-avoid">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-700">
                {titleCase(group.category)}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {group.items.map((it) => {
                  const key = `${it.category}:${it.item}`
                  return (
                    <li key={key}>
                      <label className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-forge-600"
                          checked={!!checked[key]}
                          onChange={() => toggleCheck(key)}
                        />
                        <span className={checked[key] ? 'line-through text-stone-400' : ''}>
                          <span className="text-stone-500">{it.amount}</span> · {it.item}
                          {it.inSeason === true && <span className="ml-1" title="in season">🌿</span>}
                          <span className="block text-xs text-stone-400">{reuseNote(it)}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl">Pantry &amp; staples</h2>
          <span className="text-sm text-stone-500">
            {staplesToBuy.length} to buy · reusable
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          One purchase covers the whole plan. Tick “have it” for things already in your kitchen — we'll
          remember and skip them next time.
        </p>
        <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {list.staples.map((it) => {
            const isOwned = owned.has(pantryKey(it.item))
            return <StapleRow key={`${it.category}:${it.item}`} item={it} owned={isOwned} onToggle={() => toggleOwned(it.item)} />
          })}
        </ul>
      </div>
    </div>
  )
}

function StapleRow({
  item,
  owned,
  onToggle,
}: {
  item: GroceryItem
  owned: boolean
  onToggle: () => void
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className={owned ? 'text-stone-400 line-through' : ''}>
        {item.item}
        <span className="ml-2 text-xs text-stone-400">{reuseNote(item)}</span>
      </span>
      <button
        onClick={onToggle}
        className={`shrink-0 rounded px-2 py-0.5 text-xs ring-1 transition ${
          owned
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'
        }`}
      >
        {owned ? 'have it ✓' : 'have it?'}
      </button>
    </li>
  )
}

const unique = (arr: string[]): string[] => [...new Set(arr)]
