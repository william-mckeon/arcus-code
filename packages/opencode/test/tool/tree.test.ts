import { describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import { TreeTool } from "../../src/tool/tree"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Git } from "@/git"

// The map-rendering rules are covered exhaustively in core/test/tree-map.test.ts.
// What is asserted here is the wiring: that the tool reaches the filesystem,
// reports honest metadata, and refuses the one input that would otherwise
// produce a confusing answer.

const toolLayer = LayerNode.compile(
  LayerNode.group([CrossSpawnSpawner.node, FSUtil.node, Ripgrep.node, Truncate.node, Agent.node, Git.node]),
)

const it = testEffect(toolLayer)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const write = (file: string, body = "x") => Effect.promise(() => Bun.write(file, body))

describe("tool.tree", () => {
  it.instance("maps a directory with counts and filenames", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(path.join(test.directory, "src", "main.ts"), "export const a = 1\n")
      yield* write(path.join(test.directory, "src", "util.ts"), "export const b = 2\n")
      yield* write(path.join(test.directory, "README.md"), "# hi\n")

      const info = yield* TreeTool
      const tree = yield* info.init()
      const result = yield* tree.execute({ path: test.directory }, ctx)

      expect(result.output).toContain("README.md")
      expect(result.output).toContain("src/")
      expect(result.output).toContain("main.ts")
      expect(result.output).toContain("util.ts")
      expect(result.metadata.directories).toBeGreaterThanOrEqual(2)
    }),
  )

  it.instance("reports an empty directory rather than omitting it", () =>
    Effect.gen(function* () {
      // Omitting it lets an answer conclude the directory is not there at all,
      // which is the failure class this whole phase is about.
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "keep", ".keep"), ""))
      yield* Effect.promise(async () => {
        const fs = await import("fs")
        fs.mkdirSync(path.join(test.directory, "hollow"), { recursive: true })
      })

      const info = yield* TreeTool
      const tree = yield* info.init()
      const result = yield* tree.execute({ path: test.directory }, ctx)
      expect(result.output).toContain("hollow/")
    }),
  )

  it.instance("depth is measured from the requested path", () =>
    Effect.gen(function* () {
      // Measuring from the workspace instead made a nested request come back
      // looking empty, which was read as "the file is missing".
      const test = yield* TestInstance
      yield* write(path.join(test.directory, "a", "b", "c", "deep.ts"), "x\n")

      const info = yield* TreeTool
      const tree = yield* info.init()
      const result = yield* tree.execute({ path: path.join(test.directory, "a", "b"), depth: 2 }, ctx)
      expect(result.output).toContain("deep.ts")
    }),
  )

  it.instance("a directory cut off by depth says how many it withheld", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(path.join(test.directory, "one", "two", "buried.ts"), "x\n")

      const info = yield* TreeTool
      const tree = yield* info.init()
      const result = yield* tree.execute({ path: test.directory, depth: 1 }, ctx)
      expect(result.output).not.toContain("buried.ts")
      expect(result.output).toContain("not shown -- raise depth")
    }),
  )

  it.instance("refuses a file, and says what to use instead", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "solo.ts")
      yield* write(file, "x\n")

      const info = yield* TreeTool
      const tree = yield* info.init()
      // The tool pipes through Effect.orDie, so the throw becomes a defect
      // rather than a typed failure -- squash the cause to read it, as the
      // glob test does for its equivalent rejection.
      const exit = yield* tree.execute({ path: file }, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(String(error)).toContain("not a directory")
        expect(String(error)).toContain("read")
      }
    }),
  )

  it.instance("metadata reports truncation honestly", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* write(path.join(test.directory, "a.ts"), "x\n")

      const info = yield* TreeTool
      const tree = yield* info.init()
      const result = yield* tree.execute({ path: test.directory }, ctx)
      expect(result.metadata.truncated).toBe(false)
      expect(result.metadata.lines).toBeGreaterThan(0)
    }),
  )
})
