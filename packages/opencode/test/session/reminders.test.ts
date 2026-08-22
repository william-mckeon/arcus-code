import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Agent } from "../../src/agent/agent"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionReminders } from "../../src/session/reminders"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

// Mode prompts reach the model as synthetic user parts appended by
// SessionReminders.apply. Nothing tested this mechanism before -- plan mode has
// relied on it untested since it shipped -- and collaborate mode is now a second
// consumer of it. A mode whose instructions silently fail to be injected is a
// mode that quietly is not a mode.

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionProjector.node,
      MessageV2.node,
      Agent.node,
      Permission.node,
      FSUtil.node,
      RuntimeFlags.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

const agentNamed = (name: string): Agent.Info => ({
  name,
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
})

/** One user turn, in the shape apply() expects to append onto. */
const turn = (sessionID: SessionID, text = "do the thing") => {
  const messageID = MessageID.ascending()
  return [
    {
      info: { id: messageID, sessionID, role: "user" as const },
      parts: [{ id: PartID.ascending(), messageID, sessionID, type: "text" as const, text }],
    },
  ] as never
}

const applyFor = (agent: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create()
    const messages = yield* SessionReminders.apply({
      messages: turn(session.id),
      agent: agentNamed(agent),
      session,
    })
    const parts = messages[messages.length - 1]!.parts
    return parts.map((part) => ("text" in part ? String(part.text) : "")).join("\n")
  })

describe("session.reminders", () => {
  it.instance("injects the collaborate rule when the agent is collaborate", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Collaborate Mode")
      // The distinguishing rule. Without this clause the mode collapses into
      // ordinary ask-when-unsure behaviour, which build already does.
      expect(text).toContain("EVEN WHEN YOU ARE CERTAIN")
    }),
  )

  it.instance("the collaborate rule states that looking is ungated", () =>
    Effect.gen(function* () {
      // A mode that asked before reading would be unusable, and would spend the
      // developer's attention on the one decision they do not need to make.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Looking is free")
    }),
  )

  it.instance("does not inject the collaborate rule for build", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("build")
      expect(text).not.toContain("Collaborate Mode")
    }),
  )

  it.instance("does not inject the collaborate rule for plan", () =>
    Effect.gen(function* () {
      // Plan gets its own reminder; the two must not stack, or the model is told
      // both to hold for confirmation and that it may not act at all.
      const text = yield* applyFor("plan")
      expect(text).not.toContain("Collaborate Mode")
    }),
  )

  it.instance("still injects the plan rule for plan, unaffected by the new branch", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("plan")
      expect(text).toContain("Plan Mode")
    }),
  )

  it.instance("leaves the original user text intact", () =>
    Effect.gen(function* () {
      // The reminder is appended, never substituted. Losing the user's own words
      // would be a far worse failure than losing the reminder.
      const sessions = yield* Session.Service
      const session = yield* sessions.create()
      const messages = yield* SessionReminders.apply({
        messages: turn(session.id, "the original request"),
        agent: agentNamed("collaborate"),
        session,
      })
      const parts = messages[messages.length - 1]!.parts
      expect(parts.some((part) => "text" in part && part.text === "the original request")).toBe(true)
    }),
  )
})
