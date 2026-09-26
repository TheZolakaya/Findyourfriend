# 🔥 MealForge

A personalized meal-plan generator. You enter your stats, goals, and dietary
restrictions; MealForge computes transparent daily targets and generates a
multi-day plan with full recipes, per-meal macros, swaps, and a consolidated
shopping list.

**The design principle:** the deterministic, auditable parts (calorie/macro
targets, restriction filtering, macro validation) live in **code**; the
creative, variety-generating parts (recipes) live in the **model**. You can see
and override every number; nothing is a black box.

---

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

Out of the box it runs in **sample mode** — instant placeholder plans, no API
key needed — so you can use the whole flow immediately.

### Enabling live AI recipes

1. Copy `.env.example` to `.env`.
2. Paste your Anthropic API key after `ANTHROPIC_API_KEY=`
   (get one at https://console.anthropic.com/).
3. Restart `npm run dev`.

The key is read **only** by the local backend (`server/index.ts`) and is never
sent to the browser. Once a key is present, a “Use live AI” toggle appears on
the targets screen.

---

## How it works

```
Intake (multi-step, resumable)
   └─ computeTargets()  ← pure Mifflin–St Jeor math, fully unit-tested
        └─ Review & edit targets (show the math; override anything)
             └─ Generate
                  ├─ sample mode: src/lib/fixtures.ts
                  └─ live mode:  POST /api/generate → Claude (structured JSON)
                        └─ validatePlan(): restriction + macro check in code;
                           any failing day is regenerated server-side
                             └─ Plan dashboard → recipes, swap, regenerate
                                  └─ Shopping list (consolidated) · export · print
```

## Scripts

| Command            | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `npm run dev`      | Runs the web app (5173) and the API server (8787)   |
| `npm test`         | Runs the unit tests (targets + shopping-list logic) |
| `npm run build`    | Type-checks and builds the production web bundle     |
| `npm run dev:web`  | Web only                                             |
| `npm run dev:api`  | API server only                                      |

## Project layout

```
server/index.ts          Express proxy: holds the key, calls Claude, validates,
                         regenerates failing days. Reuses the pure lib modules.
src/lib/
  schema.ts              Data model: zod schemas + JSON Schemas for the AI
  targets.ts             Mifflin–St Jeor + macros (pure, no AI)   ← targets.test.ts
  validate.ts            Restriction filtering + macro tolerance checks
  shoppingList.ts        Consolidate ingredients, sum quantities   ← shoppingList.test.ts
  prompts.ts             All model instructions, in one place
  generate.ts            Service interface: mock (fixtures) ↔ live (API)
  fixtures.ts            Deterministic sample plans for offline/dev
  export.ts              Markdown export
  storage.ts             localStorage persistence (zod-validated)
src/components/          React UI (intake, targets, plan, shopping, saved)
src/store.ts             Zustand app state
```

## Notes

- Allergies and dietary restrictions are treated as **absolute**. They are
  enforced in code (`validate.ts`), not left to the model — the server
  regenerates any day that includes a forbidden ingredient.
- Targets are editable. Editing marks them “manual”; “Reset to computed”
  restores the formula output.
- Plans persist locally in the browser (localStorage). No account, no server DB.

> MealForge gives general estimates. If you have a medical condition, are
> pregnant, or have a history that warrants individualized guidance, check your
> targets with a doctor or registered dietitian.

---

## Also in this repo: 👀 Screen Buddy

`screen-buddy/` is a separate always-on-top desktop app. It's an AI buddy that
looks at your screen and chats about it. See [screen-buddy/README.md](screen-buddy/README.md).
