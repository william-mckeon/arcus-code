import { describe, expect, test } from "bun:test"
import { GroundingEvidence } from "../../src/session/grounding/evidence"

// Minimal shapes. The collector only reads type/tool/state, so building whole
// schema-valid parts here would obscure what each case is actually about.
const toolPart = (tool: string, input: Record<string, unknown>, status: "completed" | "error" = "completed") =>
  ({
    type: "tool",
    tool,
    state: status === "completed" ? { status: "completed", input } : { status: "error", input, error: "boom" },
  }) as never

const collect = (parts: unknown[]) => GroundingEvidence.collect({ parts: parts as never, kindOf: () => "missing" })

describe("grounding evidence", () => {
  test("a read records the path as touched", () => {
    const e = collect([toolPart("read", { filePath: "src/a.ts" })])
    expect([...e.touched]).toEqual(["src/a.ts"])
    expect(e.mutations).toBe(0)
  })

  test("a write counts as both touched and a mutation", () => {
    const e = collect([toolPart("write", { filePath: "src/b.ts" })])
    expect([...e.touched]).toEqual(["src/b.ts"])
    expect(e.mutations).toBe(1)
  })

  test("a read is never a mutation", () => {
    // Otherwise a read-only run would satisfy a "I created the file" claim.
    const e = collect([toolPart("read", { filePath: "a.ts" }), toolPart("read", { filePath: "b.ts" })])
    expect(e.mutations).toBe(0)
  })

  test("a failed tool call is not evidence of anything", () => {
    // A read that errored proves nothing about the file, and a failed write is
    // not a mutation -- counting either would ground a claim on work that did
    // not happen, which is the opposite of the point.
    const e = collect([toolPart("write", { filePath: "src/c.ts" }, "error")])
    expect([...e.touched]).toEqual([])
    expect(e.mutations).toBe(0)
  })

  test("paths are normalized the same way citations are", () => {
    const e = collect([toolPart("read", { filePath: ".\\src\\d.ts" })])
    expect([...e.touched]).toEqual(["src/d.ts"])
  })

  test("glob and grep do not count as engaging a file", () => {
    // They enumerate many paths into a capped, truncated result body, so
    // treating a listing as "the agent read this" would ground a citation on
    // something it may never have opened.
    const e = collect([toolPart("glob", { pattern: "**/*.ts" }), toolPart("grep", { pattern: "foo" })])
    expect([...e.touched]).toEqual([])
  })

  test("webfetch records the url", () => {
    const e = collect([toolPart("webfetch", { url: "https://x.dev/a" })])
    expect([...e.fetched]).toEqual(["https://x.dev/a"])
  })

  test("a real check command marks the turn verified", () => {
    expect(collect([toolPart("bash", { command: "bun test" })]).verified).toBe(true)
  })

  test("an ordinary command does not", () => {
    // The scar this guards: a bare build|lint match let `mkdir build` silence
    // the unverified-success net for the whole turn.
    expect(collect([toolPart("bash", { command: "mkdir build" })]).verified).toBe(false)
    expect(collect([toolPart("bash", { command: "git status" })]).verified).toBe(false)
  })

  test("non-tool parts are ignored", () => {
    const e = collect([{ type: "text", text: "hello" }, toolPart("read", { filePath: "a.ts" })])
    expect([...e.touched]).toEqual(["a.ts"])
  })
})
