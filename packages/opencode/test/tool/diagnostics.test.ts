import { describe, expect, test } from "bun:test"
import { ToolDiagnostics } from "@opencode-ai/core/tool/diagnostics"

// These assert what each message must NOT let a reader conclude, not its exact
// wording -- the phrasing should stay free to improve, but a message that stops
// asserting existence has lost the only property it exists for.

describe("binary file", () => {
  // The scar: `Cannot read binary file: logo.png` never said logo.png was
  // there, and a run reported the asset as missing from the directory it was
  // sitting in.
  const message = ToolDiagnostics.binaryFile("assets/logo.png", 20_480)

  test("says the file exists", () => {
    expect(message).toContain("exists")
    expect(message).toContain("assets/logo.png")
  })

  test("rules out the missing-file reading explicitly", () => {
    expect(message.toLowerCase()).toContain("not a missing file")
  })

  test("never uses the bare wording that caused the misread", () => {
    expect(message).not.toStartWith("Cannot read binary file")
  })

  test("reports the size when known, and omits it cleanly when not", () => {
    expect(message).toContain("20 KB")
    const unsized = ToolDiagnostics.binaryFile("a.bin")
    expect(unsized).toContain("exists")
    expect(unsized).not.toContain("undefined")
    expect(unsized).not.toContain("()")
  })

  test("a nonsense size does not leak into the sentence", () => {
    for (const size of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const text = ToolDiagnostics.binaryFile("a.bin", size)
      expect(text).not.toContain("NaN")
      expect(text).not.toContain("Infinity")
      expect(text).not.toContain("-1")
    }
  })
})

describe("no matches", () => {
  // The old text was "No files found", which names the wrong noun: the files
  // were found, the pattern was not.
  const message = ToolDiagnostics.noMatches({ pattern: "getAuthToken", searched: "src/session" })

  test("names the pattern and the path that was searched", () => {
    expect(message).toContain("getAuthToken")
    expect(message).toContain("src/session")
  })

  test("attributes the empty result to the pattern, not to the files", () => {
    expect(message).toContain("pattern did not match")
    expect(message).not.toContain("No files found")
  })

  test("denies the absence reading outright", () => {
    expect(message).toContain("not evidence the text is absent")
  })

  test("carries the include filter, so a narrowed search is visible", () => {
    // Without this, `include: "*.py"` in a TypeScript repo produces an empty
    // result indistinguishable from the symbol genuinely not existing.
    expect(ToolDiagnostics.noMatches({ pattern: "x", searched: ".", include: "*.py" })).toContain("*.py")
  })
})

describe("no files matching", () => {
  const message = ToolDiagnostics.noFilesMatching({ pattern: "**/*.py", searched: "packages/core" })

  test("names the pattern and the path", () => {
    expect(message).toContain("**/*.py")
    expect(message).toContain("packages/core")
  })

  test("settles the directory's existence, since it was read successfully", () => {
    expect(message).toContain("directory exists and was searched")
  })

  test("denies the empty-directory reading", () => {
    expect(message).toContain("not evidence the directory is empty")
  })
})

describe("file not found", () => {
  test("with no near misses it stays short", () => {
    expect(ToolDiagnostics.fileNotFound("src/nope.ts")).toBe("File not found: src/nope.ts")
  })

  test("near misses are offered", () => {
    const message = ToolDiagnostics.fileNotFound("src/nope.ts", ["src/note.ts", "src/nodes.ts"])
    expect(message).toContain("Did you mean one of these?")
    expect(message).toContain("src/note.ts")
    expect(message).toContain("src/nodes.ts")
  })
})

describe("nearby", () => {
  test("matches in both directions", () => {
    // An entry containing the name catches a truncated guess; a name containing
    // the entry catches a wrong extension or a suffix that is not really there.
    expect(ToolDiagnostics.nearby(["config.ts", "unrelated.ts"], "config")).toEqual(["config.ts"])
    expect(ToolDiagnostics.nearby(["config.ts", "unrelated.ts"], "config.ts.bak")).toEqual(["config.ts"])
  })

  test("is case insensitive", () => {
    expect(ToolDiagnostics.nearby(["README.md"], "readme.md")).toEqual(["README.md"])
  })

  test("caps the list so a wide directory does not bury the message", () => {
    const entries = ["a1.ts", "a2.ts", "a3.ts", "a4.ts", "a5.ts"]
    expect(ToolDiagnostics.nearby(entries, "a").length).toBe(3)
  })

  test("an empty name suggests nothing", () => {
    // Otherwise every entry matches -- "" is a substring of all of them -- and
    // the message fills with noise that reads as a list of candidates.
    expect(ToolDiagnostics.nearby(["a.ts", "b.ts"], "")).toEqual([])
  })

  test("no near miss is not an error", () => {
    expect(ToolDiagnostics.nearby(["x.ts"], "completely-different")).toEqual([])
  })
})
