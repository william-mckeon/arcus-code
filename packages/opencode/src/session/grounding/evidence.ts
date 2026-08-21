export * as GroundingEvidence from "./evidence"

// Turns a session's message parts into the evidence the grounding checks need.
//
// Kept apart from ../grounding.ts on purpose: everything there is a pure
// function over strings, testable without a session, a filesystem or Effect.
// This file is the only part that knows what a SessionV1 part looks like, so
// the detectors stay portable and this stays small.

import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { norm, ranCheck, writesFiles, type Evidence, type PathKind } from "../grounding"

// Tools whose ARGUMENTS name a specific file. Deliberately excludes glob, grep
// and list: those enumerate many paths into a result body that is capped and
// truncated, so treating their output as "the agent engaged this file" would
// ground a citation on something the model may never have actually read.
const ENGAGED = new Set(["read", "write", "edit", "apply_patch"])

// Of those, the ones that CHANGE a file. A completion claim is measured against
// these, so a read must never count.
const MUTATING = new Set(["write", "edit", "apply_patch"])

const PATH_KEYS = ["filePath", "path", "file"] as const
// Commands that enumerate a directory. Reading a file inside one proves the
// file is there; only a listing supports a claim about what the directory as a
// whole holds. Biased to over-match: a command wrongly counted as a listing
// silences a check, while one missed accuses a truthful answer of lying.
const LIST_CMD = /(?:^|[|;&]\s*)(?:ls|dir|tree|find|fd|Get-ChildItem|gci|Get-Item)\b/i

function toolPaths(part: SessionV1.ToolPart) {
  const input = part.state.status === "completed" ? part.state.input : undefined
  if (!input || typeof input !== "object") return undefined
  for (const key of PATH_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === "string" && value) return norm(value)
  }
  return undefined
}

function toolInput(part: SessionV1.ToolPart, key: string) {
  const input = part.state.status === "completed" ? part.state.input : undefined
  if (!input || typeof input !== "object") return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" && value ? value : undefined
}
function toolCommand(part: SessionV1.ToolPart) {
  const input = part.state.status === "completed" ? part.state.input : undefined
  if (!input || typeof input !== "object") return undefined
  const value = (input as Record<string, unknown>)["command"]
  return typeof value === "string" ? value : undefined
}

function toolUrl(part: SessionV1.ToolPart) {
  const input = part.state.status === "completed" ? part.state.input : undefined
  if (!input || typeof input !== "object") return undefined
  const value = (input as Record<string, unknown>)["url"]
  return typeof value === "string" ? value : undefined
}

/**
 * Collect evidence from the parts of this turn.
 *
 * Only COMPLETED tool calls count. A read that errored proves nothing about the
 * file, and a failed write is not a mutation -- counting either would ground a
 * claim on work that did not happen, which is the opposite of the point.
 */
export function collect(input: { parts: readonly SessionV1.Part[]; kindOf: (path: string) => PathKind }): Evidence {
  const touched = new Set<string>()
  const listed = new Set<string>()
  let shellListedUnknown = false
  const fetched = new Set<string>()
  let mutations = 0
  let verified = false

  for (const part of input.parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed") continue

    // A read of a DIRECTORY is a listing -- the read tool answers one with the
    // directory contents rather than an error.
    if (part.tool === "read") {
      const p = toolPaths(part)
      if (p !== undefined && input.kindOf(p) !== "file") listed.add(p)
    }

    // A tree maps a whole subtree in one call, so it is the strongest listing
    // evidence there is -- and the cheapest way for a run to earn the right to
    // describe a directory. With no path it maps the workspace root, which the
    // directory check reads as "everything was enumerated".
    if (part.tool === "tree") {
      listed.add(toolPaths(part) ?? "")
    }

    // A glob enumerates whatever its path or its literal pattern prefix names.
    if (part.tool === "glob") {
      const scoped = toolPaths(part)
      if (scoped !== undefined) listed.add(scoped)
      const pattern = toolInput(part, "pattern")
      if (pattern) {
        const literal = pattern.split(/[*?[{]/, 1)[0] ?? ""
        const prefix = norm(literal.includes("/") ? literal.slice(0, literal.lastIndexOf("/")) : "")
        if (scoped === undefined || prefix) listed.add(scoped ? norm(`${scoped}/${prefix}`) : prefix)
      }
    }

    if (ENGAGED.has(part.tool)) {
      const p = toolPaths(part)
      if (p) touched.add(p)
      if (MUTATING.has(part.tool)) mutations++
    }

    if (part.tool === "webfetch") {
      const url = toolUrl(part)
      if (url) fetched.add(url)
    }

    if (part.tool === "bash") {
      const command = toolCommand(part)
      // A check that completed is a check that exited 0 -- the tool reports a
      // non-zero exit as an error state, which the status guard above excludes.
      if (ranCheck(command)) verified = true
      // Shell is how most files actually get written. Without this a truthful
      // "I created the file" after a redirect was reported as unbacked.
      if (writesFiles(command)) mutations++
      if (LIST_CMD.test(command ?? "")) {
        // Attribute it to a path if we can. If we cannot, record that a listing
        // happened but its target is unknown, which stands the directory check
        // down entirely -- silence beats a false accusation.
        const args = (command ?? "")
          .split(/\s+/)
          .slice(1)
          .filter((a) => a && !a.startsWith("-"))
          .map((a) => norm(a.replace(/^["']|["']$/g, "")))
        if (args.length > 0) for (const a of args) listed.add(a)
        else shellListedUnknown = true
      }
    }
  }

  return { touched, fetched, listed, shellListedUnknown, mutations, verified, kindOf: input.kindOf }
}
