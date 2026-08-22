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

// Live finding: a run created a file with a shell redirect, said "I created the
// file `made.txt`" -- which was true -- and was told nothing had been written.
describe("grounding evidence from shell writes", () => {
  test("a redirect counts as a mutation", () => {
    expect(collect([toolPart("bash", { command: "echo done > made.txt" })]).mutations).toBe(1)
  })

  test("common file-writing commands count", () => {
    for (const cmd of ["cp a b", "mv a b", "touch x", "mkdir -p y", "tee out.txt", "sed -i s/a/b/ f"]) {
      expect(collect([toolPart("bash", { command: cmd })]).mutations).toBe(1)
    }
  })

  test("PowerShell forms count too", () => {
    for (const cmd of ["Set-Content x.txt 'hi'", "New-Item -ItemType File z", "Out-File -FilePath a.txt"]) {
      expect(collect([toolPart("bash", { command: cmd })]).mutations).toBe(1)
    }
  })

  test("a read-only command does not", () => {
    for (const cmd of ["git status", "ls -la", "cat file.txt", "grep foo bar"]) {
      expect(collect([toolPart("bash", { command: cmd })]).mutations).toBe(0)
    }
  })

  test("a failed command is not a mutation", () => {
    expect(collect([toolPart("bash", { command: "echo x > y" }, "error")]).mutations).toBe(0)
  })

  test("a command can both check and write", () => {
    // "bun test > out.log" verifies AND writes; both must be recorded.
    const e = collect([toolPart("bash", { command: "bun test > out.log" })])
    expect(e.verified).toBe(true)
    expect(e.mutations).toBe(1)
  })
})

// Listing a directory is its own kind of evidence. Opening a file inside one
// proves that file is there; only an enumeration supports a claim about what
// the directory as a whole holds.
describe("grounding evidence — directory listings", () => {
  const collectWith = (
    parts: unknown[],
    kind: (p: string) => "file" | "nonEmptyDirectory" | "emptyDirectory" | "missing",
  ) => GroundingEvidence.collect({ parts: parts as never, kindOf: kind })

  test("a read of a directory counts as listing it", () => {
    // The read tool answers a directory with its contents, not an error.
    const e = collectWith([toolPart("read", { filePath: "src" })], () => "nonEmptyDirectory")
    expect([...e.listed]).toEqual(["src"])
  })

  test("a read of a file does not", () => {
    const e = collectWith([toolPart("read", { filePath: "src/a.ts" })], () => "file")
    expect([...e.listed]).toEqual([])
    expect([...e.touched]).toEqual(["src/a.ts"])
  })

  test("a glob records the directory it searched", () => {
    const e = collect([toolPart("glob", { pattern: "**/*.ts", path: "packages/core" })])
    expect([...e.listed]).toContain("packages/core")
  })

  test("a glob pattern's literal prefix counts", () => {
    const e = collect([toolPart("glob", { pattern: "src/session/*.ts" })])
    expect([...e.listed]).toContain("src/session")
  })

  test("a shell listing with a path is attributed to it", () => {
    const e = collect([toolPart("bash", { command: "ls -R centpilot" })])
    expect([...e.listed]).toContain("centpilot")
    expect(e.shellListedUnknown).toBe(false)
  })

  test("a shell listing with no path stands the check down", () => {
    // Better to silence the directory check than accuse a truthful answer.
    const e = collect([toolPart("bash", { command: "ls" })])
    expect(e.shellListedUnknown).toBe(true)
  })

  test("a non-listing command records nothing", () => {
    const e = collect([toolPart("bash", { command: "git status" })])
    expect([...e.listed]).toEqual([])
    expect(e.shellListedUnknown).toBe(false)
  })

  test("a command merely containing 'ls' is not a listing", () => {
    for (const cmd of ["curl https://x.dev", "tools/build.sh"]) {
      expect(collect([toolPart("bash", { command: cmd })]).shellListedUnknown).toBe(false)
    }
  })
})

// Phase 3. The presence detector fires when an answer describes a directory the
// run never enumerated; tree is the one call that enumerates one. Without this
// the agent would be easier to CATCH than to satisfy, which is the wrong way
// round -- the tool exists so "look before you describe" costs one call.
describe("grounding evidence — tree", () => {
  test("a tree of a path counts as listing that path", () => {
    const e = collect([toolPart("tree", { path: "packages/core" })])
    expect([...e.listed]).toContain("packages/core")
  })

  test("a tree with no path counts as enumerating the workspace", () => {
    // The directory check stands down entirely on this, since everything was
    // mapped and no claim about a directory can be unsupported.
    const e = collect([toolPart("tree", {})])
    expect([...e.listed]).toContain("")
  })

  test("a tree is not a mutation and does not mark the turn verified", () => {
    const e = collect([toolPart("tree", { path: "src" })])
    expect(e.mutations).toBe(0)
    expect(e.verified).toBe(false)
  })

  test("a failed tree proves nothing", () => {
    const e = collect([toolPart("tree", { path: "src" }, "error")])
    expect([...e.listed]).toEqual([])
  })
})
