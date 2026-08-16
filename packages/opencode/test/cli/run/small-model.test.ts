import { describe, expect, test } from "bun:test"
import { selectSmallModel } from "../../../src/cli/cmd/run/small-model"
import type { RunProvider } from "../../../src/cli/cmd/run/types"

const NOW = Date.parse("2026-08-15")
const recent = "2026-07-30"

function model(input: { name: string; input: number; output: number; release?: string; status?: string }) {
  return {
    id: input.name,
    providerID: "p",
    api: {},
    name: input.name,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: input.input, output: input.output, cache: {} },
    limit: { context: 1000, output: 1000 },
    status: input.status ?? "active",
    options: {},
    headers: {},
    release_date: input.release ?? recent,
  }
}

function providers(models: Record<string, ReturnType<typeof model>>): RunProvider[] {
  return [{ id: "p", name: "P", source: "config", env: [], options: {}, models }] as unknown as RunProvider[]
}

const current = { providerID: "p", modelID: "big" }

describe("selectSmallModel", () => {
  test("picks the cheapest model on the current provider", () => {
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 1, output: 4.05 }),
        mid: model({ name: "mid-small", input: 0.5, output: 1.2 }),
        cheap: model({ name: "flash", input: 0.14, output: 0.28 }),
      }),
      current,
      now: NOW,
    })
    expect(result?.modelID).toBe("cheap")
    expect(result?.cost).toBeCloseTo(0.42)
  })

  test("returns undefined when the provider has nothing cheaper", () => {
    // The `opencode` provider does exactly this in practice — it resolved to no
    // small model at all, so the command has to cope rather than assume one.
    const result = selectSmallModel({
      providers: providers({ big: model({ name: "big", input: 1, output: 4.05 }) }),
      current,
      now: NOW,
    })
    expect(result).toBeUndefined()
  })

  test("never returns the model already in use", () => {
    const result = selectSmallModel({
      providers: providers({ big: model({ name: "big-flash", input: 0.01, output: 0.01 }) }),
      current,
      now: NOW,
    })
    expect(result).toBeUndefined()
  })

  test("still resolves when the only option costs more than the current model", () => {
    // No cheaper-than-current gate: invoking the command is the decision, and
    // refusing made it look like the command had been ignored.
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 0.1, output: 0.1 }),
        other: model({ name: "other-mini", input: 5, output: 5 }),
      }),
      current,
      now: NOW,
    })
    expect(result?.modelID).toBe("other")
  })

  test("prefers a small-named model over a merely cheap old flagship", () => {
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 2, output: 8 }),
        legacy: model({ name: "legacy-pro", input: 0.2, output: 0.4, release: "2025-06-01" }),
        mini: model({ name: "mini", input: 0.5, output: 1 }),
      }),
      current,
      now: NOW,
    })
    expect(result?.modelID).toBe("mini")
  })

  test("falls back to cheapest when no name looks small", () => {
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 2, output: 8 }),
        alpha: model({ name: "alpha", input: 0.3, output: 0.6 }),
        beta: model({ name: "beta", input: 1, output: 2 }),
      }),
      current,
      now: NOW,
    })
    expect(result?.modelID).toBe("alpha")
  })

  test("skips models older than 18 months", () => {
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 2, output: 8 }),
        ancient: model({ name: "ancient-mini", input: 0.01, output: 0.01, release: "2023-01-01" }),
      }),
      current,
      now: NOW,
    })
    expect(result).toBeUndefined()
  })

  test("skips deprecated and unpriced models", () => {
    const result = selectSmallModel({
      providers: providers({
        big: model({ name: "big", input: 2, output: 8 }),
        gone: model({ name: "gone-mini", input: 0.1, output: 0.1, status: "deprecated" }),
        // Unpriced sorts to zero and would win every time.
        unpriced: model({ name: "unpriced-mini", input: 0, output: 0 }),
      }),
      current,
      now: NOW,
    })
    expect(result).toBeUndefined()
  })

  test("does not cross providers", () => {
    const list = [
      ...providers({ big: model({ name: "big", input: 2, output: 8 }) }),
      { id: "other", name: "Other", source: "config", env: [], options: {}, models: { tiny: model({ name: "tiny", input: 0.01, output: 0.01 }) } },
    ] as unknown as RunProvider[]
    expect(selectSmallModel({ providers: list, current, now: NOW })).toBeUndefined()
  })

  test("returns undefined with no current model or no providers", () => {
    expect(selectSmallModel({ providers: undefined, current, now: NOW })).toBeUndefined()
    expect(selectSmallModel({ providers: providers({}), current: undefined, now: NOW })).toBeUndefined()
  })
})
