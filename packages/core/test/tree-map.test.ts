import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { TreeMap } from "@opencode-ai/core/tool/tree-map"

// A project map is read as a statement about what exists, so every way it can
// be wrong is a way to manufacture a false absence -- the same failure class the
// grounding layer exists to catch. Two of the cases below are ported scars, not
// hypotheticals: both produced a wrong "that directory is empty" in a live
// review of the reference implementation.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tree-map-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const dir = (...parts: string[]) => {
  const full = path.join(root, ...parts)
  fs.mkdirSync(full, { recursive: true })
  return full
}
const file = (relative: string, body = "x") => {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return full
}

// A layout with one of everything worth distinguishing.
file("src/main.ts")
file("src/util.ts")
file("src/deep/one/two/three/buried.ts")
file("node_modules/pkg/index.js")
file("docs/README.md")
dir("empty-dir")
dir("only-subdirs/child")

describe("tree map", () => {
  test("counts files per directory and names them", () => {
    const out = TreeMap.build({ root, depth: 1 }).text
    expect(out).toContain("src/  (2 files)")
    expect(out).toContain("main.ts")
    expect(out).toContain("util.ts")
  })

  test("a directory with one file reads as singular", () => {
    expect(TreeMap.build({ root, depth: 2 }).text).toContain("docs/  (1 file)")
  })

  test("noise directories are excluded even with no gitignore", () => {
    // The map should show the PROJECT, not its dependencies. A workspace with
    // no .gitignore gets no protection from ripgrep, and one real sample holds
    // 2,821 files under a Go module cache.
    expect(TreeMap.build({ root, depth: 3 }).text).not.toContain("node_modules")
  })

  test("an empty directory is reported as empty, not omitted", () => {
    // Omitting it would let an answer conclude the directory does not exist.
    // `boenet/` in a real workspace holds zero files and one empty subfolder.
    expect(TreeMap.build({ root, depth: 1 }).text).toContain("empty-dir/  (empty)")
  })

  test("a directory holding only subdirectories says so, and is not called empty", () => {
    const out = TreeMap.build({ root, depth: 2 }).text
    expect(out).toContain("only-subdirs/  (no files)")
    expect(out).not.toContain("only-subdirs/  (empty)")
  })

  test("a directory whose files are all filtered out says they are ignored", () => {
    // "empty" and "everything here is ignored" are different facts. Collapsing
    // them is how an answer ends up asserting a directory holds nothing when it
    // is merely gitignored.
    const allowed = new Set(["docs/README.md"])
    const out = TreeMap.build({ root, allowed, depth: 1 }).text
    expect(out).toContain("src/  (no listed files -- contents are ignored)")
  })

  test("the allowed set filters individual files", () => {
    const out = TreeMap.build({ root, allowed: new Set(["src/main.ts"]), depth: 1 }).text
    expect(out).toContain("src/  (1 file)")
    expect(out).toContain("main.ts")
    expect(out).not.toContain("util.ts")
  })
})

// Scar: measuring depth from the workspace rather than the requested path made
// `tree("src/auth/cmd", depth=3)` return `cmd/ (0 files)` -- cmd already being
// three levels down -- which a reviewer read as "the directory is empty", of a
// directory whose contents had been read earlier in the same session.
describe("tree map depth is measured from the requested root", () => {
  test("a deep path still shows its own subtree", () => {
    const out = TreeMap.build({ root: path.join(root, "src/deep"), depth: 3 }).text
    expect(out).toContain("buried.ts")
  })

  test("depth 0 shows the root's own files and no children", () => {
    const out = TreeMap.build({ root, depth: 0 }).text
    expect(out).not.toContain("main.ts")
    expect(out).toContain("not shown -- raise depth")
  })

  test("cutting off at depth announces the subdirectories it did not show", () => {
    // Silence here is what gets read as absence. The count is the whole point.
    const out = TreeMap.build({ root: path.join(root, "src"), depth: 0 }).text
    expect(out).toMatch(/1 subdirectory not shown/)
  })

  test("plural subdirectories read correctly", () => {
    expect(TreeMap.build({ root, depth: 0 }).text).toMatch(/subdirectories not shown/)
  })
})

// Scar: a single global budget let an early-alphabet directory consume it and
// truncate the map before `src/` was ever reached, so the map silently claimed
// the project had no source at all.
describe("tree map caps per directory, not globally", () => {
  const wide = fs.mkdtempSync(path.join(os.tmpdir(), "tree-wide-"))
  afterAll(() => fs.rmSync(wide, { recursive: true, force: true }))
  for (let i = 0; i < 40; i++) fs.mkdirSync(path.join(wide, "aaa"), { recursive: true })
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(wide, "aaa", `f${String(i).padStart(2, "0")}.ts`), "x")
  fs.mkdirSync(path.join(wide, "zzz"), { recursive: true })
  fs.writeFileSync(path.join(wide, "zzz", "important.ts"), "x")

  test("a fat directory does not crowd out a later one", () => {
    const out = TreeMap.build({ root: wide, depth: 1, perDirectory: 5 }).text
    expect(out).toContain("important.ts")
  })

  test("the truncated directory says how many it withheld", () => {
    const out = TreeMap.build({ root: wide, depth: 1, perDirectory: 5 }).text
    expect(out).toContain("... (+35 more files)")
  })
})

describe("tree map global bound", () => {
  test("an enormous map is cut with an actionable notice", () => {
    const result = TreeMap.build({ root, depth: 5, maxLines: 3 })
    expect(result.truncated).toBe(true)
    expect(result.text).toContain("map truncated at 3 lines")
    expect(result.text).toContain("pass a subpath or a smaller depth")
  })

  test("a map that fits is not marked truncated", () => {
    expect(TreeMap.build({ root, depth: 1 }).truncated).toBe(false)
  })
})

describe("tree map robustness", () => {
  test("a path that does not exist yields the empty map rather than throwing", () => {
    const result = TreeMap.build({ root: path.join(root, "nope"), depth: 2 })
    expect(result.truncated).toBe(false)
    expect(result.text).toContain("(empty)")
  })

  test("entries are ordered deterministically", () => {
    const first = TreeMap.build({ root, depth: 2 }).text
    const second = TreeMap.build({ root, depth: 2 }).text
    expect(first).toBe(second)
  })

  test("dotfile directories are skipped", () => {
    dir(".hidden-dir")
    expect(TreeMap.build({ root, depth: 1 }).text).not.toContain(".hidden-dir")
  })
})
