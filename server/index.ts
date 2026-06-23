import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

import {
  GeneratedMealSchema,
  GeneratedPlanSchema,
  MEAL_JSON_SCHEMA,
  PLAN_JSON_SCHEMA,
  ProfileSchema,
  TargetsSchema,
  type DayPlan,
  type Meal,
  type Profile,
  type Targets,
} from '../src/lib/schema'
import { buildPlanUserPrompt, buildSwapUserPrompt, buildSystemPrompt } from '../src/lib/prompts'
import { buildExclusions, checkDayMacros, validatePlan } from '../src/lib/validate'
import { z } from 'zod'

const MODEL = process.env.MEALFORGE_MODEL || 'claude-opus-4-8'
const PORT = Number(process.env.PORT) || 8787
const API_KEY = process.env.ANTHROPIC_API_KEY?.trim()

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null

// ---------------------------------------------------------------------------
// Model call: structured outputs force schema-valid JSON; we parse defensively
// and retry once on malformed output.
// ---------------------------------------------------------------------------

async function callModel(
  system: string,
  user: string,
  schema: object,
  maxTokens = 32000,
): Promise<unknown> {
  if (!client) throw new Error('No ANTHROPIC_API_KEY configured on the server.')

  const run = async (): Promise<unknown> => {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
      // Structured outputs — the response's text block is guaranteed-shaped JSON.
      output_config: { format: { type: 'json_schema', schema } },
    } as Parameters<typeof client.messages.stream>[0])

    const msg = await stream.finalMessage()
    const text = msg.content.find((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    if (!text) throw new Error('Model returned no text content.')
    return JSON.parse(text.text)
  }

  try {
    return await run()
  } catch (e) {
    if (e instanceof SyntaxError) return await run() // one retry on bad JSON
    throw e
  }
}

// Generate exactly `days` days, numbered starting at `startDay`.
async function generateDays(
  profile: Profile,
  targets: Targets,
  days: number,
  startDay: number,
  varietyHint: string | undefined,
): Promise<DayPlan[]> {
  const system = buildSystemPrompt(profile, targets)
  const user = buildPlanUserPrompt({ days, profile, varietyHint })
  const raw = await callModel(system, user, PLAN_JSON_SCHEMA)
  const parsed = GeneratedPlanSchema.parse(raw)
  return parsed.days.map((d, i) => ({ ...d, day: startDay + i }))
}

async function generateSingleDay(
  profile: Profile,
  targets: Targets,
  day: number,
  varietyHint: string | undefined,
): Promise<DayPlan> {
  const [d] = await generateDays(profile, targets, 1, day, varietyHint)
  return d
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ hasKey: Boolean(client), model: MODEL })
})

const GenerateBody = z.object({
  profile: ProfileSchema,
  targets: TargetsSchema,
  days: z.number().int().min(1).max(14),
  varietyHint: z.string().optional(),
})

app.post('/api/generate', async (req, res) => {
  const parsed = GenerateBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body.' })
    return
  }
  const { profile, targets, days, varietyHint } = parsed.data
  try {
    let planDays = await generateDays(profile, targets, days, 1, varietyHint)

    // Code-side validation pass. Regenerate any day that breaks a hard rule.
    let validation = validatePlan({ days: planDays }, targets, profile)
    if (validation.failingDays.length) {
      for (const day of validation.failingDays) {
        try {
          const fixed = await generateSingleDay(profile, targets, day, varietyHint)
          // Only accept the regenerated day if it's actually clean.
          const check = validatePlan({ days: [fixed] }, targets, profile)
          if (check.ok) planDays = planDays.map((d) => (d.day === day ? fixed : d))
        } catch {
          /* keep the original day if regeneration fails */
        }
      }
      validation = validatePlan({ days: planDays }, targets, profile)
    }

    res.json({ days: planDays, validation })
  } catch (e) {
    res.status(statusFor(e)).json({ error: messageFor(e) })
  }
})

const SwapBody = z.object({
  profile: ProfileSchema,
  targets: TargetsSchema,
  day: z.number().int(),
  meal: z.object({}).passthrough(),
  otherTitlesToday: z.array(z.string()),
})

app.post('/api/swap', async (req, res) => {
  const parsed = SwapBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body.' })
    return
  }
  const { profile, targets, day } = parsed.data
  const meal = parsed.data.meal as unknown as Meal
  const exclusions = buildExclusions(profile)
  const system = buildSystemPrompt(profile, targets)
  const user = buildSwapUserPrompt({
    day,
    slot: meal.slot,
    replacing: meal,
    otherTitlesToday: parsed.data.otherTitlesToday,
  })

  const attempt = async (): Promise<Meal> => {
    const raw = await callModel(system, user, MEAL_JSON_SCHEMA, 8000)
    return GeneratedMealSchema.parse(raw).meal
  }

  try {
    let result = await attempt()
    // Verify the swap doesn't introduce a forbidden ingredient.
    if (mealHasExclusion(result, exclusions)) {
      const retry = await attempt()
      if (!mealHasExclusion(retry, exclusions)) result = retry
    }
    res.json({ meal: result })
  } catch (e) {
    res.status(statusFor(e)).json({ error: messageFor(e) })
  }
})

// ---------------------------------------------------------------------------

function mealHasExclusion(meal: Meal, exclusions: string[]): boolean {
  const hay = [meal.title, ...meal.ingredients.map((i) => i.item)].join(' ').toLowerCase()
  return exclusions.some((ex) => hay.includes(ex))
}

// silence unused-import lint for checkDayMacros (kept available for future use)
void checkDayMacros

function statusFor(e: unknown): number {
  const s = (e as { status?: number })?.status
  return typeof s === 'number' ? s : 500
}

function messageFor(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status?: number }).status
    if (status === 401) return 'Invalid API key. Check ANTHROPIC_API_KEY in your .env file.'
    if (status === 429) return 'Rate limited by the API. Wait a moment and try again.'
    if (status && status >= 500) return 'The model API had a server error. Try again shortly.'
  }
  return e instanceof Error ? e.message : 'Generation failed.'
}

app.listen(PORT, () => {
  const keyState = client ? 'API key loaded' : 'NO API KEY (running mock-only)'
  console.log(`MealForge API on http://localhost:${PORT}  [${keyState}, model=${MODEL}]`)
})
