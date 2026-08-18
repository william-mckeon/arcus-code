import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseResponse, searchFailureReason } from "../../src/tool/mcp-websearch"
import {
  mergeWebSearchKeys,
  selectWebSearchProvider,
  webSearchModelName,
  webSearchProviderLabel,
} from "../../src/tool/websearch"

import { webSearchEnabled } from "../../src/tool/registry"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"
const NO_FLAGS = { exa: false, parallel: false, tavily: false }
// Selection and the availability gate both read API keys, so every case passes
// them explicitly. Left to the environment these tests would pass or fail based
// on whether the machine running them happens to have a search key exported.
const NO_KEYS = {}

describe("websearch provider", () => {
  test("selects a stable provider per session", () => {
    expect(selectWebSearchProvider(SESSION_ID)).toBe(selectWebSearchProvider(SESSION_ID))
  })

  test("does not vary by session", () => {
    // The old behaviour was checksum(sessionID) % 2, so two sessions could get
    // different search engines with nothing to explain why.
    expect(selectWebSearchProvider("ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaa", NO_FLAGS, NO_KEYS)).toBe(
      selectWebSearchProvider("ses_bbbbbbbbbbbbbbbbbbbbbbbbbbbb", NO_FLAGS, NO_KEYS),
    )
  })

  test("supports an operational override", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "exa"
      expect(selectWebSearchProvider(SESSION_ID)).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { ...NO_FLAGS, exa: true }, NO_KEYS)).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { ...NO_FLAGS, parallel: true }, NO_KEYS)).toBe("parallel")
  })

  test("routes to Tavily when the Tavily flag is enabled", () => {
    expect(selectWebSearchProvider(SESSION_ID, { ...NO_FLAGS, tavily: true }, NO_KEYS)).toBe("tavily")
  })

  test("a single configured key selects its provider", () => {
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, { tavily: "key" })).toBe("tavily")
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, { parallel: "key" })).toBe("parallel")
  })

  // Regression: deferring to the default whenever several keys were set meant a
  // valid Tavily key alongside a stale Exa one selected Exa and failed the
  // search, having ignored the only credential that worked.
  test("several keys resolve by precedence, not by falling back to the default", () => {
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, { tavily: "key", exa: "key" })).toBe("tavily")
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, { parallel: "key", exa: "key" })).toBe("parallel")
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, { tavily: "key", parallel: "key", exa: "key" })).toBe("tavily")
  })

  test("falls back to the default only when no key is configured at all", () => {
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, NO_KEYS)).toBe("exa")
  })

  test("an explicit flag beats a configured key", () => {
    expect(selectWebSearchProvider(SESSION_ID, { ...NO_FLAGS, parallel: true }, { tavily: "key" })).toBe("parallel")
  })

  test("is enabled for opencode, an explicit flag, or a configured key", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode, NO_FLAGS, NO_KEYS)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, NO_FLAGS, NO_KEYS)).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, { ...NO_FLAGS, exa: true }, NO_KEYS)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { ...NO_FLAGS, parallel: true }, NO_KEYS)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { ...NO_FLAGS, tavily: true }, NO_KEYS)).toBe(true)
  })

  test("a configured key makes web search available on any model provider", () => {
    // The gate used to be opencode-only, which hid the tool from every other
    // provider even when the operator had credentials for a search backend.
    expect(webSearchEnabled(ProviderV2.ID.openai, NO_FLAGS, { tavily: "key" })).toBe(true)
  })

  // Search keys live in the same auth.json as the model providers, so a key set
  // once through `providers login` works in every shell and directory. An
  // exported variable still wins, because that is how CI and one-off runs
  // expect to override a stored setting.
  test("a stored credential is used when nothing is exported", () => {
    expect(mergeWebSearchKeys({ tavily: "stored" }, {})).toEqual({
      tavily: "stored",
      parallel: undefined,
      exa: undefined,
    })
  })

  test("an exported key overrides the stored one", () => {
    expect(mergeWebSearchKeys({ tavily: "stored" }, { tavily: "exported" }).tavily).toBe("exported")
  })

  test("stored and exported keys for different providers both survive", () => {
    const merged = mergeWebSearchKeys({ tavily: "stored" }, { exa: "exported" })
    expect(merged.tavily).toBe("stored")
    expect(merged.exa).toBe("exported")
    // Precedence then decides, and a stored Tavily key still beats an Exa one.
    expect(selectWebSearchProvider(SESSION_ID, NO_FLAGS, merged)).toBe("tavily")
  })

  test("uses branded labels", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(webSearchProviderLabel("tavily")).toBe("Tavily Web Search")
    expect(webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for Parallel analytics", () => {
    expect(
      webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  it.effect("parses plain JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(payload)
      expect(result).toBe("search results")
    }),
  )

  it.effect("parses SSE JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`event: message\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )

  it.effect("ignores non-JSON SSE data frames", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`data: [DONE]\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )
})

// Payloads below are the real ones, captured from each provider with a bad key.
// Both answer HTTP 200 and put the refusal in the result, so nothing upstream
// sees a failure -- and they disagree on how to express it, which is why the
// MCP isError flag is not used: Tavily returns isError false on a 401.
describe("websearch failure detection", () => {
  test("recognises Tavily's JSON error body", () => {
    const body = JSON.stringify({
      error: "Search failed",
      status: 401,
      detail: { error: "Unauthorized: missing or invalid API key." },
      documentation: "https://docs.tavily.com/",
    })
    expect(searchFailureReason(body)).toBe("Search failed (401): Unauthorized: missing or invalid API key.")
  })

  test("recognises Exa's prose error line", () => {
    const body = "web_search_exa error (401): Invalid API key\nTimestamp: 2026-08-18T22:53:54.847Z"
    expect(searchFailureReason(body)).toBe("Invalid API key (401)")
  })

  test("treats real results as success", () => {
    expect(
      searchFailureReason("Title: 7-Day Forecast\nURL: https://forecast.weather.gov/\nHigh: 81 F"),
    ).toBeUndefined()
    expect(searchFailureReason(undefined)).toBeUndefined()
    expect(searchFailureReason("")).toBeUndefined()
  })

  test("does not cry wolf over results that merely mention an error", () => {
    // Prose about errors is a legitimate search result, not a failed search.
    expect(searchFailureReason("Title: How to fix a 401 error\nURL: https://example.com")).toBeUndefined()
    // Well-formed JSON without an error field is a result too.
    expect(searchFailureReason('{"results":[{"title":"x"}]}')).toBeUndefined()
  })
})
