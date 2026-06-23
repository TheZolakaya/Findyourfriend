import { useState } from 'react'

const KEY = 'mealforge.disclaimerDismissed.v1'

/**
 * Responsible-use notice. Dismissible, but shown by default to everyone — the
 * tool serves a wide range of people and some need individualized guidance.
 */
export function Disclaimer() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  return (
    <div className="no-print bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-start gap-3">
        <span aria-hidden>ℹ️</span>
        <p className="flex-1">
          MealForge gives general estimates. If you have a medical condition, are pregnant, or have a
          history that warrants individualized advice, please check your targets with a doctor or
          registered dietitian.
        </p>
        <button
          className="shrink-0 rounded px-2 py-0.5 text-amber-700 hover:bg-amber-100"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1')
            } catch {
              /* ignore */
            }
            setDismissed(true)
          }}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
