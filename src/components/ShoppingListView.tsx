import { useMemo, useState } from 'react'
import type { Plan } from '../lib/schema'
import { buildShoppingList, groupByCategory } from '../lib/shoppingList'
import { titleCase } from '../lib/display'

export function ShoppingListView({ plan }: { plan: Plan }) {
  const groups = useMemo(() => groupByCategory(buildShoppingList(plan)), [plan])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  const toggle = (key: string) => setChecked((c) => ({ ...c, [key]: !c[key] }))

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">Shopping list</h2>
        <span className="text-sm text-stone-500">{total} items</span>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-6">
        {groups.map((group) => (
          <div key={group.category} className="break-inside-avoid">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-700">
              {titleCase(group.category)}
            </h3>
            <ul className="mt-2 space-y-1">
              {group.items.map((it) => {
                const key = `${group.category}:${it.item}`
                return (
                  <li key={key}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-forge-600"
                        checked={!!checked[key]}
                        onChange={() => toggle(key)}
                      />
                      <span className={checked[key] ? 'line-through text-stone-400' : ''}>
                        <span className="text-stone-500">{it.totalAmount}</span> · {it.item}
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
  )
}
