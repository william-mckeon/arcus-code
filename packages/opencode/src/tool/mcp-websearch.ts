import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const EXA_BASE_URL = "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"

// Built from a function rather than a module constant read at import time, so a
// key resolved from the auth store -- not just the environment -- reaches the
// URL. Exa carries its credential in the query string.
export function exaUrl(apiKey: string | undefined = process.env.EXA_API_KEY) {
  if (!apiKey) return EXA_BASE_URL
  return `${EXA_BASE_URL}?exaApiKey=${encodeURIComponent(apiKey)}`
}

// Tavily carries its key in the query string like Exa, not in a header like
// Parallel.
export const TAVILY_BASE_URL = "https://mcp.tavily.com/mcp/"
export function tavilyUrl(apiKey: string | undefined = process.env.TAVILY_API_KEY) {
  if (!apiKey) return TAVILY_BASE_URL
  return `${TAVILY_BASE_URL}?tavilyApiKey=${encodeURIComponent(apiKey)}`
}

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decode(trimmed)
    return data.result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const ParallelSearchArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
})

// Mirrors tavily_search as the live endpoint reports it: query is the only
// required field. Only the arguments the shared tool can actually populate are
// modelled -- Tavily also accepts domain filters, date ranges and image
// options, which nothing upstream of here can currently express.
export const TavilySearchArgs = Schema.Struct({
  query: Schema.String,
  max_results: Schema.optional(Schema.Number),
  search_depth: Schema.optional(Schema.String),
})

// The shared `type` parameter is Exa's vocabulary. Tavily names the same idea
// differently and offers a fourth level, so map rather than pass through:
// 'deep' means spend more, 'fast' means spend less, and 'auto' takes Tavily's
// own default rather than inventing a preference.
export function tavilySearchDepth(type: string | undefined) {
  if (type === "deep") return "advanced"
  if (type === "fast") return "fast"
  return "basic"
}

const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({
      name: Schema.String,
      arguments: args,
    }),
  })

export const call = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  headers?: Record<string, string>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error(`${tool} request timed out`)) }),
      )
    const body = yield* response.text
    return yield* parseResponse(body)
  })
