// Deliberate duplicate of the server-side label in
// packages/opencode/src/tool/websearch.ts: the TUI cannot import from the
// server package, and the provider arrives as opaque tool metadata. Keep the
// two in step -- a provider missing here degrades to the generic label rather
// than failing, so the omission is silent.
export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  if (provider === "tavily") return "Tavily Web Search"
  return "Web Search"
}

export function toolDisplayMetadata(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {}
  if (!("status" in state) || state.status === "pending") return {}
  if (!("structured" in state) || !state.structured || typeof state.structured !== "object") return {}
  if (Array.isArray(state.structured)) return {}
  return state.structured as Record<string, unknown>
}
