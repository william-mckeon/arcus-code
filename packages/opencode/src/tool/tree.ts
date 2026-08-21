import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { TreeMap } from "@opencode-ai/core/tool/tree-map"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./tree.txt"
import * as Tool from "./tool"

// A one-call project map. The rendering lives in core/tool/tree-map so this and
// the v2 tool are two thin wrappers over one implementation rather than two
// implementations that drift -- which is exactly how grep ended up searching a
// whole directory when asked about a single file.

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description:
      "Directory to map. Defaults to the current working directory. Depth is measured from THIS path, so mapping a nested folder still shows the levels beneath it.",
  }),
  depth: Schema.optional(NonNegativeInt).annotate({
    description: `How many levels to descend (default ${TreeMap.DEFAULT_DEPTH}). A directory cut off by this limit reports how many subdirectories it did not show.`,
  }),
})

// Enough to cover any real project while bounding the walk. Ripgrep is asked
// only for the ignore decision, not for the structure, so a project larger than
// this simply falls back to the noise list -- a coarser filter, never a wrong
// map.
const IGNORE_SAMPLE_LIMIT = 20_000

export const TreeTool = Tool.define(
  "tree",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { path?: string; depth?: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const requested = params.path ?? ins.directory
          const target = path.isAbsolute(requested) ? requested : path.join(ins.directory, requested)

          yield* ctx.ask({
            permission: "tree",
            patterns: [target],
            always: ["*"],
            metadata: { path: params.path, depth: params.depth },
          })

          const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, target, {
            bypass: false,
            kind: info?.type === "Directory" ? "directory" : "file",
          })
          if (info && info.type !== "Directory") {
            throw new Error(`${target} is a file, not a directory. tree maps directories; use read for a file.`)
          }

          const root = FSUtil.resolve(target)

          // Ripgrep supplies the ignore decision -- it reads .gitignore, which is
          // the repository's own statement about what is not part of it, and no
          // hand-kept list can stay in step with that. It is deliberately not
          // the source of the STRUCTURE: it lists files only, so a directory
          // holding no files would vanish from the map entirely, and a directory
          // that silently vanishes is exactly how an answer comes to claim
          // something is not there.
          const allowed = yield* ripgrep.glob({ cwd: root, pattern: "**/*", limit: IGNORE_SAMPLE_LIMIT }).pipe(
            Effect.map((entries) => new Set(entries.map((entry) => entry.path.replaceAll("\\", "/")))),
            Effect.catch(() => Effect.succeed(undefined)),
          )

          const map = TreeMap.build({
            root,
            // A saturated sample means the filter is incomplete, and filtering
            // against a partial list would hide real files. Fall back to the
            // noise list, which is coarser but never wrong about existence.
            allowed: allowed && allowed.size < IGNORE_SAMPLE_LIMIT ? allowed : undefined,
            depth: params.depth,
          })

          return {
            title: path.relative(ins.worktree, root) || path.basename(root),
            metadata: {
              directories: map.directories,
              lines: map.lines,
              truncated: map.truncated,
            },
            output: map.text,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
