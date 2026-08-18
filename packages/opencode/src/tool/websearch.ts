import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "@/auth"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel", "tavily"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export type WebSearchFlags = { exa: boolean; parallel: boolean; tavily: boolean }
export type WebSearchKeys = { exa?: string; parallel?: string; tavily?: string }

export function webSearchKeysFromEnv(): WebSearchKeys {
  return {
    exa: process.env.EXA_API_KEY,
    parallel: process.env.PARALLEL_API_KEY,
    tavily: process.env.TAVILY_API_KEY,
  }
}

// Search credentials live in the same auth.json the model providers use, under
// their own provider id, so `providers login` stores one the same way it stores
// any other. Nothing about that store is model-specific: an entry is
// { type: "api", key }, which is exactly what a search key is.
// Takes the already-resolved Auth service rather than yielding it. Yielding it
// here would leave Auth in the R channel of whatever calls this, and a tool's
// execute must carry no outstanding requirements.
export const webSearchKeysFromAuth = Effect.fn("WebSearch.keysFromAuth")(function* (auth: Auth.Interface) {
  const keys: { -readonly [K in keyof WebSearchKeys]: WebSearchKeys[K] } = {}
  for (const provider of WEBSEARCH_KEY_PRECEDENCE) {
    const stored = yield* auth.get(provider).pipe(Effect.orElseSucceed(() => undefined))
    if (stored?.type === "api" && stored.key) keys[provider] = stored.key
  }
  return keys as WebSearchKeys
})

// The environment wins over the stored credential. A stored key is the settled
// choice; an exported one is a deliberate override for this run, which is how
// CI and one-off invocations expect to work.
export function mergeWebSearchKeys(stored: WebSearchKeys, env: WebSearchKeys = webSearchKeysFromEnv()): WebSearchKeys {
  return {
    tavily: env.tavily || stored.tavily,
    parallel: env.parallel || stored.parallel,
    exa: env.exa || stored.exa,
  }
}

export const resolveWebSearchKeys = Effect.fn("WebSearch.resolveKeys")(function* (auth: Auth.Interface) {
  return mergeWebSearchKeys(yield* webSearchKeysFromAuth(auth))
})

// Exa last: it is the only provider that answers unauthenticated, so a key set
// for it says least about what the operator wants.
const WEBSEARCH_KEY_PRECEDENCE = ["tavily", "parallel", "exa"] as const

const DEFAULT_PROVIDER: WebSearchProvider = "exa"

// Selection used to be `checksum(sessionID) % 2`, an A/B split that handed each
// session a different search engine with nothing to explain the difference.
// That does not survive a third provider -- `% 3` would only make it stranger --
// so the choice is now declared rather than drawn.
//
// A configured key is treated as intent: setting TAVILY_API_KEY and nothing else
// is how most people will expect to select Tavily, without also having to name
// it. The result no longer depends on the session, so it is stable across a
// project.
//
// Several keys resolve by the precedence below rather than falling back to the
// default. An earlier version deferred to the default whenever the choice was
// ambiguous, which read as cautious and behaved badly: a valid Tavily key
// alongside a stale Exa one selected Exa and failed, having ignored the only
// credential the operator had actually got right. Exa is last precisely because
// it is the one that works unauthenticated, so a key set for it is the weakest
// evidence of intent; Tavily and Parallel do nothing without one.
export function selectWebSearchProvider(
  _sessionID: string,
  flags: WebSearchFlags = { exa: false, parallel: false, tavily: false },
  keys: WebSearchKeys = webSearchKeysFromEnv(),
  configured?: WebSearchProvider,
): WebSearchProvider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel" || override === "tavily") return override
  if (configured) return configured

  if (flags.tavily) return "tavily"
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  const keyed = WEBSEARCH_KEY_PRECEDENCE.filter((provider) => keys[provider])
  if (keyed.length > 0) return keyed[0]

  return DEFAULT_PROVIDER
}

// Exported so callers can report which credentials were in play when several
// are set, rather than leaving the choice unexplained.
export function ambiguousWebSearchKeys(keys: WebSearchKeys = webSearchKeysFromEnv()) {
  return WEBSEARCH_KEY_PRECEDENCE.filter((provider) => keys[provider])
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  if (provider === "tavily") return "Tavily Web Search"
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

function parallelAuthHeaders(apiKey: string | undefined) {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!apiKey) return headers
  return { ...headers, Authorization: `Bearer ${apiKey}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
  keys: WebSearchKeys,
) {
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.query,
        search_queries: [params.query],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(keys.parallel),
    )
  }

  if (provider === "tavily") {
    // livecrawl and contextMaxCharacters have no Tavily equivalent and are
    // dropped, the same way Parallel drops them. See the note on the tool
    // description about advertising options a given provider may not honour.
    return McpWebSearch.call(
      http,
      McpWebSearch.tavilyUrl(keys.tavily),
      "tavily_search",
      McpWebSearch.TavilySearchArgs,
      {
        query: params.query,
        max_results: params.numResults || 8,
        search_depth: McpWebSearch.tavilySearchDepth(params.type),
      },
      "25 seconds",
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.exaUrl(keys.exa),
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    const auth = yield* Auth.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const keys = yield* resolveWebSearchKeys(auth)
          const provider = selectWebSearchProvider(
            ctx.sessionID,
            { exa: flags.enableExa, parallel: flags.enableParallel, tavily: flags.enableTavily },
            keys,
          )
          const title = webSearchProviderLabel(provider)
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider } })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider,
            },
          })

          const result = yield* callProvider(http, provider, params, ctx, keys)

          // A provider that rejects the credential still answers 200 with the
          // refusal as the result text, so nothing upstream treats it as a
          // failure and the only trace is whatever the model then says about
          // it. An expired key would otherwise be invisible in the log.
          const failure = McpWebSearch.searchFailureReason(result)
          if (failure) {
            yield* Effect.logWarning("web search failed", {
              provider,
              "session.id": ctx.sessionID,
              reason: failure,
            })
          }

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
