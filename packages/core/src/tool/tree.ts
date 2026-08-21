export * as TreeTool from "./tree"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { NonNegativeInt, RelativePath } from "../schema"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { TreeMap } from "./tree-map"
import { Tool } from "./tool"
import { Tools } from "./tools"

// The v2 half of the one-call project map. Both this and the v1 tool are thin
// wrappers over ./tree-map, so the two cannot drift -- which is what happened
// with grep, where v2 restricted a single-file search correctly and v1 did not.

export const name = "tree"

export const Input = Schema.Struct({
  path: RelativePath.pipe(Schema.optional).annotate({
    description:
      "Relative directory to map. Defaults to the active Location. Depth is measured from THIS path, so mapping a nested folder still shows the levels beneath it.",
  }),
  depth: NonNegativeInt.pipe(Schema.optional).annotate({
    description: `How many levels to descend (default ${TreeMap.DEFAULT_DEPTH}).`,
  }),
})

export const Output = Schema.Struct({
  text: Schema.String,
  // Plain numbers: these are diagnostic counts about the map, not domain
  // values that anything downstream constrains.
  directories: Schema.Number,
  lines: Schema.Number,
  truncated: Schema.Boolean,
})

// See the v1 tool: ripgrep decides what is IGNORED, never what EXISTS. It lists
// files only, so a directory holding none would vanish from the map, and a
// directory that silently vanishes is how an answer comes to claim it is absent.
const IGNORE_SAMPLE_LIMIT = 20_000

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Map a project's folder structure in ONE call: every directory with a file count and a sample of its filenames, with dependency and build directories skipped. Use it first to orient before a broad review, instead of firing several globs and inferring the shape. Directories holding no files are reported as such rather than omitted. `path` scopes the map and `depth` limits nesting.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.path ?? "."],
                save: ["*"],
                metadata: { path: input.path, depth: input.depth },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const root = path.resolve(location.directory, input.path ?? ".")
              const allowed = yield* ripgrep.glob({ cwd: root, pattern: "**/*", limit: IGNORE_SAMPLE_LIMIT }).pipe(
                Effect.map((result) => ({
                  allowed: new Set(result.items.map((entry) => entry.path.replaceAll("\\", "/"))),
                  truncated: result.truncated,
                })),
                Effect.catch(() => Effect.succeed({ allowed: undefined, truncated: true })),
              )

              const map = TreeMap.build({
                root,
                // See the v1 tool: a truncated ignore list would hide real files,
                // so fall back to the noise list rather than filter against a
                // partial one. Truncation is now reported, not inferred.
                allowed: allowed.truncated ? undefined : allowed.allowed,
                depth: input.depth,
              })

              return {
                text: map.text,
                directories: map.directories,
                lines: map.lines,
                truncated: map.truncated,
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to map ${input.path ?? "."}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/tree",
  layer,
  deps: [ToolRegistry.node, Ripgrep.node, Location.node, PermissionV2.node],
})
