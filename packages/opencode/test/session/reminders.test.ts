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
import { Todo } from "../../src/session/todo"
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
      Todo.node,
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
      // The mode is build plus a statement of intent. Three earlier versions
      // built a gate instead -- confirm even when certain, then a phase machine
      // -- and neither ever showed a measurable benefit while both produced
      // questions asking the developer to re-affirm what they had just said.
      expect(text).toContain("exactly build's capabilities")
      expect(text).toContain("it is what you say while doing it")
    }),
  )

  it.instance("asks for findings with file and line, not a restatement", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Say what you found")
      expect(text).toContain("Cite file and line")
    }),
  )

  it.instance("says narrating is not asking", () =>
    Effect.gen(function* () {
      // The steering mechanism is interruption, not permission. A developer who
      // can see what you are about to do can stop you in one sentence; one who
      // is asked to approve each edit is doing the agent's filing.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Narrating is not asking")
      expect(text).toContain("they interrupt, you adjust")
    }),
  )

  it.instance("requires naming what could NOT be verified", () =>
    Effect.gen(function* () {
      // A run tested a Go backend eight times from PowerShell, reported "live
      // test passed", and the frontend was broken throughout: the browser sends
      // a preflight first and no shell client does. The test passed; it was the
      // wrong test, and nothing said so.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Say what you could NOT verify")
      expect(text).toContain("say where the edge was")
    }),
  )

  it.instance("forbids re-asking what the developer just said", () =>
    Effect.gen(function* () {
      // Asked for a README, it replied ["Create simple README", "Wait, change
      // scope"] -- two substantive options by every rule, and still a question
      // with nothing to decide.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Do NOT ask the developer to confirm what they just told you")
      expect(text).toContain("is not a question")
    }),
  )

  it.instance("requires the question tool rather than prose", () =>
    Effect.gen(function* () {
      // A session assessed correctly, cited the lines, wrote "Confirm: ...?" as
      // TEXT, and edited the file in the very next step with no human between.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("use the question tool -- never prose")
      expect(text).toContain("returns control")
    }),
  )

  it.instance("says a decline is not the second option", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("each PROPOSE something")
      expect(text).toContain("is a way out, not an alternative")
    }),
  )

  it.instance("gates destructive shell, and says approval does not cover collateral", () =>
    Effect.gen(function* () {
      // It gated sixteen times on writing files, then force-killed a process it
      // had never named, to free a port for a server it had been asked to start.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("APPROVAL FOR A GOAL IS NOT APPROVAL FOR THE COLLATERAL")
      expect(text).toContain("state OUTSIDE the")
    }),
  )

  it.instance("tells it to believe a reported symptom", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Believe the observation")
    }),
  )

  it.instance("says to ask the failing surface for its own error", () =>
    Effect.gen(function* () {
      // The browser console names the mechanism, both origins and the preflight
      // in one line. Re-deriving that from the server side took six steps.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("ASK FOR THAT SURFACE'S")
      expect(text).toContain("browser console")
    }),
  )

  it.instance("tells it not to invent a path root", () =>
    Effect.gen(function* () {
      // Seven distinct fabricated roots in one day of testing -- /workspace,
      // /workdir, /tmp, /work, /backend, /c, /app. In one run it ran
      // `mkdir -p backend frontend/src` correctly and then wrote to
      // /workspace/backend/main.go in the same turn.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Use the path the tools gave you")
      expect(text).toContain("succeeds somewhere nobody will look")
    }),
  )

  // The plan has to be visible without a tool call. `todowrite` writes and
  // nothing reads back, so the model only knew its own list because the tool
  // RESULT echoed it into the conversation -- a copy compaction removes, which
  // is exactly when a long build most needs to know what was already settled.
  // Measured before this shipped: 9 todowrite calls out of 1158, 0.8%.
  it.instance("injects the todo list so the plan survives compaction", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const todos = yield* Todo.Service
      const session = yield* sessions.create()
      yield* todos.update({
        sessionID: session.id,
        todos: [
          { content: "write the go backend", status: "completed", priority: "high" },
          { content: "write the react widget", status: "in_progress", priority: "high" },
        ],
      })
      const messages = yield* SessionReminders.apply({
        messages: turn(session.id),
        agent: agentNamed("collaborate"),
        session,
      })
      const text = messages[messages.length - 1]!.parts
        .map((part) => ("text" in part ? String(part.text) : ""))
        .join("\n")
      expect(text).toContain("Your current todo list")
      expect(text).toContain("write the go backend")
      expect(text).toContain("write the react widget")
    }),
  )

  it.instance("puts a blocked task first and states why", () =>
    Effect.gen(function* () {
      // A blocked task is the only thing worth interrupting the developer for,
      // so it must not be buried under the tasks that are merely pending.
      const sessions = yield* Session.Service
      const todos = yield* Todo.Service
      const session = yield* sessions.create()
      yield* todos.update({
        sessionID: session.id,
        todos: [
          { content: "write the react widget", status: "pending", priority: "medium" },
          { content: "run the go backend", status: "blocked", priority: "high", blockedReason: "go is not installed" },
        ],
      })
      const messages = yield* SessionReminders.apply({
        messages: turn(session.id),
        agent: agentNamed("collaborate"),
        session,
      })
      const text = messages[messages.length - 1]!.parts
        .map((part) => ("text" in part ? String(part.text) : ""))
        .join("\n")
      expect(text).toContain("go is not installed")
      expect(text).toContain("A task is BLOCKED")
      expect(text.indexOf("run the go backend")).toBeLessThan(text.indexOf("write the react widget"))
    }),
  )

  it.instance("says nothing about todos when there are none", () =>
    Effect.gen(function* () {
      // The phase model injected an "empty plan" notice here so the model could
      // infer which phase it was in. With the phases gone that is noise on
      // every early turn.
      const sessions = yield* Session.Service
      const session = yield* sessions.create()
      const messages = yield* SessionReminders.apply({
        messages: turn(session.id),
        agent: agentNamed("collaborate"),
        session,
      })
      const text = messages[messages.length - 1]!.parts
        .map((part) => ("text" in part ? String(part.text) : ""))
        .join("\n")
      expect(text).not.toContain("Your current todo list")
    }),
  )

  it.instance("does not inject the todo list for build", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const todos = yield* Todo.Service
      const session = yield* sessions.create()
      yield* todos.update({
        sessionID: session.id,
        todos: [{ content: "write the go backend", status: "pending", priority: "high" }],
      })
      const messages = yield* SessionReminders.apply({
        messages: turn(session.id),
        agent: agentNamed("build"),
        session,
      })
      const text = messages[messages.length - 1]!.parts
        .map((part) => ("text" in part ? String(part.text) : ""))
        .join("\n")
      expect(text).not.toContain("Your current todo list")
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
