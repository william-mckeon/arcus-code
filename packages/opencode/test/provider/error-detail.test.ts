import { describe, expect, test } from "bun:test"
// Import via the @/ alias, as every other test here does. A relative path
// resolves to a second module instance, the runtime gets initialised twice and
// only one copy is disposed, and the preload's afterAll hangs on teardown.
import { parseStreamError } from "@/provider/error"

// The Codex backend (chatgpt.com/backend-api/codex) reports failures as a bare
// { detail: "..." } -- no `type`, no `error` object. parseStreamError switched
// on body.error.code behind an `if (body.type !== "error") return` guard, so
// this shape fell through untouched and the actionable message surfaced as a
// raw JSON blob.
//
// The message is the whole point: "The 'gpt-5.3-codex-spark' model is not
// supported when using Codex with a ChatGPT account" says exactly what to do.

const CODEX_REJECTION = {
  detail: "The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.",
}

describe("parseStreamError - Codex detail bodies", () => {
  test("surfaces the detail message instead of a raw body", () => {
    const parsed = parseStreamError(CODEX_REJECTION)
    expect(parsed?.type).toBe("api_error")
    expect(parsed?.message).toBe(CODEX_REJECTION.detail)
  })

  test("marks it non-retryable", () => {
    // Retrying an unsupported model just burns the turn: the answer will not
    // change until a different model is chosen.
    const parsed = parseStreamError(CODEX_REJECTION)
    expect(parsed && "isRetryable" in parsed ? parsed.isRetryable : undefined).toBe(false)
  })

  test("keeps the original body for the log", () => {
    const parsed = parseStreamError(CODEX_REJECTION)
    expect(parsed?.responseBody).toContain("gpt-5.3-codex-spark")
  })

  test("arrives the same way when wrapped in a message string", () => {
    // Providers hand this back as a JSON string on `message` about as often as
    // they hand back an object.
    const parsed = parseStreamError({ message: JSON.stringify(CODEX_REJECTION) })
    expect(parsed?.message).toBe(CODEX_REJECTION.detail)
  })

  test("does not shadow a real error object", () => {
    // The branch is narrow on purpose: when there IS an `error`, the existing
    // code-based handling has to win, or every mapped case regresses.
    const parsed = parseStreamError({
      type: "error",
      detail: "some incidental field",
      error: { code: "context_length_exceeded" },
    })
    expect(parsed?.type).toBe("context_overflow")
  })

  test("ignores an empty or non-string detail", () => {
    expect(parseStreamError({ detail: "" })).toBeUndefined()
    expect(parseStreamError({ detail: "   " })).toBeUndefined()
    expect(parseStreamError({ detail: { nested: true } })).toBeUndefined()
  })

  test("still ignores bodies that are neither", () => {
    expect(parseStreamError({ type: "not-an-error" })).toBeUndefined()
    expect(parseStreamError(undefined)).toBeUndefined()
  })
})
