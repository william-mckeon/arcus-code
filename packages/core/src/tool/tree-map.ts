export * as TreeMap from "./tree-map"

import fs from "fs"
import path from "path"

// Builds the one-call project map both tool sets serve.
//
// It lives in core, and both the v1 and v2 `tree` tools are thin wrappers over
// it, because writing it twice is precisely how the last defect happened: v2's
// grep restricted a single-file search correctly and v1's did not, so grepping
// one file searched its whole parent directory for months. One implementation
// cannot drift from itself.

/**
 * Directories excluded from the map regardless of what git thinks.
 *
 * Ripgrep gives .gitignore for free, which is the right primary filter -- the
 * map should show the PROJECT, not its dependencies. But a folder with no
 * .gitignore has no such protection, and those are common: one sample workspace
 * here holds 2,821 Python files under `centpilot/pkg/mod`, a Go module cache
 * that would otherwise flood the map and push the actual project off the end of
 * the line budget.
 */
export const NOISE = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "site-packages",
  "pkg",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".gradle",
  ".terraform",
  "DerivedData",
  "Pods",
])

export const DEFAULT_DEPTH = 3
export const DEFAULT_PER_DIRECTORY = 25
export const DEFAULT_MAX_LINES = 2000

/** What a directory turned out to hold, once ignore rules were applied. */
type Kind = { files: string[]; hidden: boolean }

export interface Input {
  /** Absolute path the map is rooted at -- the path the CALLER asked for. */
  readonly root: string
  /**
   * Relative paths ripgrep was willing to return, i.e. everything .gitignore
   * permits. Undefined means no filter (ripgrep unavailable); the noise list
   * then carries the whole load.
   */
  readonly allowed?: ReadonlySet<string>
  readonly depth?: number
  readonly perDirectory?: number
  readonly maxLines?: number
}

export interface Result {
  readonly text: string
  readonly lines: number
  readonly truncated: boolean
  readonly directories: number
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/**
 * Render the map.
 *
 * Two rules here are scars rather than preferences, both from the reference
 * implementation this is ported from, and both produce a FALSE ABSENCE when got
 * wrong -- the exact failure the grounding layer exists to catch:
 *
 *  - The cap is PER DIRECTORY, not global. A single global budget let an
 *    early-alphabet directory consume it and truncate the map before `src/` was
 *    ever reached, so the map silently claimed the project had no source.
 *
 *  - Depth is measured from the REQUESTED root, not the workspace. Measuring
 *    from the workspace made `tree("src/auth/cmd", depth=3)` return
 *    `cmd/ (0 files)`, because cmd is already three levels down -- read by a
 *    reviewer as "the directory is empty", of a directory whose contents had
 *    been read earlier in the same session.
 */
export function build(input: Input): Result {
  const depth = Math.max(0, input.depth ?? DEFAULT_DEPTH)
  const perDirectory = Math.max(1, input.perDirectory ?? DEFAULT_PER_DIRECTORY)
  const maxLines = Math.max(1, input.maxLines ?? DEFAULT_MAX_LINES)
  const root = input.root

  const lines: string[] = []
  let truncated = false
  let directories = 0

  const allowedFile = (relative: string) => !input.allowed || input.allowed.has(relative.split(path.sep).join("/"))

  const inspect = (dir: string): Kind => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return { files: [], hidden: false }
    }
    const files: string[] = []
    let hidden = false
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const relative = path.relative(root, path.join(dir, entry.name))
      if (allowedFile(relative)) files.push(entry.name)
      else hidden = true
    }
    return { files: files.sort((a, b) => a.localeCompare(b)), hidden }
  }

  const subdirectories = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return [] as string[]
    }
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !NOISE.has(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  }

  const walk = (dir: string, level: number) => {
    if (truncated) return
    if (lines.length >= maxLines) {
      truncated = true
      return
    }

    const indent = "  ".repeat(level)
    const label = level === 0 ? path.basename(dir) || dir : path.basename(dir)
    const { files, hidden } = inspect(dir)
    const children = subdirectories(dir)

    // Three distinct states, kept distinct on purpose. "empty" and "everything
    // here is ignored" are different facts about a directory, and collapsing
    // them is how an answer ends up asserting a directory holds nothing when it
    // is merely gitignored.
    const summary =
      files.length > 0
        ? plural(files.length, "file")
        : hidden
          ? "no listed files -- contents are ignored"
          : children.length > 0
            ? "no files"
            : "empty"

    lines.push(`${indent}${label}/  (${summary})`)
    directories++

    for (const name of files.slice(0, perDirectory)) lines.push(`${indent}  ${name}`)
    if (files.length > perDirectory) {
      // Named rather than silent: a count the reader can act on, so a partial
      // listing is never mistaken for the whole directory.
      lines.push(`${indent}  ... (+${plural(files.length - perDirectory, "more file")})`)
    }

    if (level >= depth) {
      if (children.length > 0) {
        lines.push(
          `${indent}  ... (${plural(children.length, "subdirectory", "subdirectories")} not shown -- raise depth to see them)`,
        )
      }
      return
    }
    for (const name of children) {
      walk(path.join(dir, name), level + 1)
      if (truncated) return
    }
  }

  walk(root, 0)

  let text = lines.join("\n") || "(empty)"
  if (truncated) {
    text += `\n... (map truncated at ${maxLines} lines -- pass a subpath or a smaller depth to see the rest)`
  }
  return { text, lines: lines.length, truncated, directories }
}
