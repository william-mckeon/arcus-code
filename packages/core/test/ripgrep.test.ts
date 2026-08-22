import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RelativePath } from "@opencode-ai/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Ripgrep.node))

describe("Ripgrep", () => {
  it.live("keeps ignored files out of catch-all find results", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true }))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src")))
          yield* Effect.promise(() => Bun.$`git init -q ${tmp.path}`)
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "ignored\n"))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "src", "index.js"), "included\n"))

          const files = yield* (yield* Ripgrep.Service).find({ cwd: tmp.path, pattern: "*", limit: 10 })
          expect(files.items.map((item) => item.path)).toContain(RelativePath.make("src/index.js"))
          expect(files.items.map((item) => item.path)).not.toContain(RelativePath.make("node_modules/pkg/index.js"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("never includes git metadata", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".opencode", "config"), "needle\n"))
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".git")))
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "config"), "needle\n"))
          const ripgrep = yield* Ripgrep.Service

          const files = yield* ripgrep.find({ cwd: tmp.path, pattern: "**/*", limit: 10 })
          expect(files.items.map((item) => item.path)).toContain(RelativePath.make(".opencode/config"))
          expect(files.items.map((item) => item.path)).not.toContain(RelativePath.make(".git/config"))

          const observed: string[] = []
          const limited = yield* ripgrep.find({
            cwd: tmp.path,
            pattern: "**/*",
            limit: 1,
            onEntry: (entry) => Effect.sync(() => observed.push(entry.path)),
          })
          expect(observed).toEqual(limited.items.map((item) => item.path))

          const matches = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", include: "config", limit: 10 })
          expect(matches.items.map((item) => item.entry.path)).toContain(RelativePath.make(".opencode/config"))
          expect(matches.items.map((item) => item.entry.path)).not.toContain(RelativePath.make(".git/config"))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
  it.live("does not split surrogate pairs in oversized line previews", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            fs.writeFile(path.join(tmp.path, "unicode.txt"), `needle${"x".repeat(1_993)}😀\n`),
          )

          const matches = yield* (yield* Ripgrep.Service).grep({
            cwd: tmp.path,
            pattern: "needle",
            limit: 10,
          })

          expect(matches.items[0]?.text).toBe(`needle${"x".repeat(1_993)}...`)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

// The truncation flag used to be computed here and then discarded at the
// interface boundary, so every caller re-derived it as `items.length === limit`.
// That inference cannot tell "exactly N results" from "N and more behind them",
// and both search tools shipped it -- so a search finding exactly the limit told
// the model its picture was incomplete when it was whole.
describe("Ripgrep truncation is reported, not inferred", () => {
  // The body may fail with ripgrep's own error type; the acquire/release
  // wrapper does not care, so keep the error channel open rather than
  // forcing every caller to pipe through orDie.
  const withFiles = <E>(count: number, body: (tmp: { path: string }) => Effect.Effect<void, E, Ripgrep.Service>) =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const tmp = await tmpdir()
        for (let index = 0; index < count; index++) {
          await fs.writeFile(path.join(tmp.path, `f${String(index).padStart(3, "0")}.ts`), "needle\n")
        }
        return tmp
      }),
      body,
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )

  it.live("exactly at the limit is NOT truncated", () =>
    // The bug, stated directly. Five files with a limit of five is a complete
    // answer and must not announce itself as partial.
    withFiles(5, (tmp) =>
      Effect.gen(function* () {
        const result = yield* (yield* Ripgrep.Service).glob({ cwd: tmp.path, pattern: "*.ts", limit: 5 })
        expect(result.items).toHaveLength(5)
        expect(result.truncated).toBe(false)
      }),
    ),
  )

  it.live("one past the limit IS truncated", () =>
    withFiles(6, (tmp) =>
      Effect.gen(function* () {
        const result = yield* (yield* Ripgrep.Service).glob({ cwd: tmp.path, pattern: "*.ts", limit: 5 })
        expect(result.items).toHaveLength(5)
        expect(result.truncated).toBe(true)
      }),
    ),
  )

  it.live("under the limit is not truncated", () =>
    withFiles(2, (tmp) =>
      Effect.gen(function* () {
        const result = yield* (yield* Ripgrep.Service).glob({ cwd: tmp.path, pattern: "*.ts", limit: 5 })
        expect(result.items).toHaveLength(2)
        expect(result.truncated).toBe(false)
      }),
    ),
  )

  it.live("grep reports it the same way", () =>
    withFiles(4, (tmp) =>
      Effect.gen(function* () {
        const ripgrep = yield* Ripgrep.Service
        const exact = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", limit: 4 })
        expect(exact.truncated).toBe(false)
        const over = yield* ripgrep.grep({ cwd: tmp.path, pattern: "needle", limit: 3 })
        expect(over.truncated).toBe(true)
      }),
    ),
  )
})
