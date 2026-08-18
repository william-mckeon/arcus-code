import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"

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

const DEFAULT_PROVIDER: WebSearchProvider = "exa"

// Selection used to be `checksum(sessionID) % 2`, an A/B split that handed each
// session a different search engine with nothing to explain the difference.
// That does not survive a third provider -- `% 3` would only make it stranger --
// so the choice is now declared rather than drawn.
//
// A configured key is treated as intent: setting TAVILY_API_KEY and nothing else
// is how most people will expect to select Tavily, without also having to name
// it. Only an unambiguous single key counts; with several configured the
// explicit override or flag decides, and failing that the default holds. The
// result no longer depends on the session, so it is stable across a project.
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

  const keyed = (["tavily", "parallel", "exa"] as const).filter((provider) => keys[provider])
  if (keyed.length === 1) return keyed[0]

  return DEFAULT_PROVIDER
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

function parallelAuthHeaders() {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
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
      parallelAuthHeaders(),
    )
  }

  if (provider === "tavily") {
    // livecrawl and contextMaxCharacters have no Tavily equivalent and are
    // dropped, the same way Parallel drops them. See the note on the tool
    // description about advertising options a given provider may not honour.
    return McpWebSearch.call(
      http,
      McpWebSearch.tavilyUrl(),
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
    McpWebSearch.EXA_URL,
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

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
            tavily: flags.enableTavily,
          })
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

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
