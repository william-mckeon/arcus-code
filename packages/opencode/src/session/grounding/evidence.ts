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

function toolPaths(part: SessionV1.ToolPart) {
  const input = part.state.status === "completed" ? part.state.input : undefined
  if (!input || typeof input !== "object") return undefined
  for (const key of PATH_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === "string" && value) return norm(value)
  }
  return undefined
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
export function collect(input: {
  parts: readonly SessionV1.Part[]
  kindOf: (path: string) => PathKind
}): Evidence {
  const touched = new Set<string>()
  const fetched = new Set<string>()
  let mutations = 0
  let verified = false

  for (const part of input.parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed") continue

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
    }
  }

  return { touched, fetched, mutations, verified, kindOf: input.kindOf }
}
