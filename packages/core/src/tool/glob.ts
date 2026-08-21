export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { ToolDiagnostics } from "./diagnostics"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: "Maximum results to return",
  }),
})

// Carries whether the cap was hit. It used to be a bare array, so this tool
// disclosed truncation not at all -- it silently returned at most `limit` and
// said nothing, leaving a partial answer indistinguishable from a whole one.
export const Output = Schema.Struct({
  items: Schema.Array(FileSystem.Entry),
  truncated: Schema.Boolean,
})
type ModelOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput, query?: { pattern: string; searched: string }) => {
  // "No files found" cannot distinguish a mis-aimed pattern from an empty
  // directory, so it gets read as the latter. Name what was searched.
  if (output.items.length === 0)
    return query ? ToolDiagnostics.noFilesMatching(query) : "No files matched the pattern. The directory was searched."
  const lines = output.items.map((item) => item.path)
  if (output.truncated)
    lines.push(
      "",
      ToolDiagnostics.cappedResults({ shown: output.items.length, noun: "files", narrow: "pattern or path" }),
    )
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
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
            "Find files by glob pattern within the active Location. Returns concise relative file resources. Use a relative path to narrow the search and limit to bound the result count.",
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            {
              type: "text",
              text: toModelOutput(
                {
                  items: output.items.map((entry) => ({
                    ...entry,
                    path: path.resolve(location.directory, entry.path),
                  })),
                  truncated: output.truncated,
                },
                { pattern: input.pattern, searched: path.resolve(location.directory, input.path ?? ".") },
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: input.path ?? ".",
                  path: input.path,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const cwd = path.resolve(location.directory, input.path ?? ".")
              return yield* ripgrep
                .glob({
                  cwd,
                  pattern: input.pattern,
                  limit: input.limit ?? Number.MAX_SAFE_INTEGER,
                })
                .pipe(
                  Effect.map((result) => ({
                    items: result.items.map((entry) =>
                      FileSystem.Entry.make({
                        ...entry,
                        path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                      }),
                    ),
                    truncated: result.truncated,
                  })),
                )
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to find files matching ${input.pattern}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/glob",
  layer,
  deps: [ToolRegistry.node, Ripgrep.node, Location.node, PermissionV2.node],
})
