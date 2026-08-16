import type { RunInput, RunProvider } from "./types"

/**
 * Picks the cheapest usable model from the provider you are already on.
 *
 * Deliberately does not cross providers. Switching provider changes
 * credentials, latency and tool-calling behaviour all at once, which is not
 * what someone asking for a cheaper model is agreeing to. If the current
 * provider has nothing cheaper, this returns undefined and the caller says so.
 *
 * Scoring mirrors the v2 catalog resolver in core/src/catalog.ts: 80% price,
 * 20% recency. The v1 resolver used by title generation matches on hardcoded
 * family names — `gemini-flash`, `gpt-nano`, `claude-haiku` — which finds
 * nothing on providers that carry none of those, huggingface among them. Real
 * prices are already in the payload the TUI holds, so there is no reason to
 * guess from names.
 */

/**
 * First-pass filter. A model whose name says it is small usually is, and
 * preferring those avoids picking an old flagship that has merely become cheap.
 * Falls back to scoring everything when nothing matches.
 */
const SMALL_NAME = /\b(nano|flash|lite|mini|haiku|small|fast)\b/

/** Models older than this are skipped: cheap but obsolete is a bad trade. */
const MAX_AGE_MONTHS = 18

const MONTH_MS = 1000 * 60 * 60 * 24 * 30

export type SmallModelCandidate = {
  providerID: string
  modelID: string
  name: string
  /** Combined input + output price per million tokens. */
  cost: number
}

export function selectSmallModel(input: {
  providers: RunProvider[] | undefined
  current: RunInput["model"]
  now?: number
}): SmallModelCandidate | undefined {
  if (!input.current) return undefined
  const provider = input.providers?.find((item) => item.id === input.current!.providerID)
  if (!provider) return undefined

  const now = input.now ?? Date.now()

  const candidates = Object.entries(provider.models)
    .filter(([modelID, model]) => {
      if (modelID === input.current!.modelID) return false
      if (model.status === "deprecated") return false
      // Zero cost means either genuinely free or unpriced. Unpriced would sort
      // first and win every time, so both are excluded — a free model is not a
      // saving worth switching to blind.
      const cost = model.cost.input + model.cost.output
      if (!(cost > 0)) return false
      // Modalities are booleans here, not the string array the v2 catalog uses.
      if (!model.capabilities.input.text) return false
      if (!model.capabilities.output.text) return false
      return ageMonths(model.release_date, now) <= MAX_AGE_MONTHS
    })
    .map(([modelID, model]) => ({
      providerID: provider.id,
      modelID,
      name: model.name ?? modelID,
      cost: model.cost.input + model.cost.output,
      age: ageMonths(model.release_date, now),
      small: SMALL_NAME.test(`${modelID} ${model.family ?? ""} ${model.name ?? ""}`.toLowerCase()),
    }))

  if (candidates.length === 0) return undefined

  const named = candidates.filter((item) => item.small)
  const pool = named.length > 0 ? named : candidates

  const maxCost = Math.max(...pool.map((item) => item.cost), 0.01)
  const maxAge = Math.max(...pool.map((item) => item.age), 0.01)
  const score = (item: (typeof pool)[number]) => (item.cost / maxCost) * 0.8 + (item.age / maxAge) * 0.2

  const best = pool.reduce((a, b) => (score(b) < score(a) ? b : a))

  // Only worth switching if it is actually cheaper than where we are.
  const currentModel = provider.models[input.current.modelID]
  if (currentModel) {
    const currentCost = currentModel.cost.input + currentModel.cost.output
    if (currentCost > 0 && best.cost >= currentCost) return undefined
  }

  return { providerID: best.providerID, modelID: best.modelID, name: best.name, cost: best.cost }
}

/**
 * release_date is a catalog string like "2026-07-30". Treat anything
 * unparseable as brand new rather than ancient, so a malformed date does not
 * silently exclude a model.
 */
function ageMonths(releaseDate: string | undefined, now: number) {
  if (!releaseDate) return 0
  const parsed = Date.parse(releaseDate)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, (now - parsed) / MONTH_MS)
}
