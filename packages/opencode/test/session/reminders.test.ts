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
      // The distinguishing rule is no longer "confirm even when certain" -- that
      // was the micromanagement primitive, and it produced 16 questions against
      // 20 edits in one real session. What distinguishes the mode now is WHEN
      // the developer is involved: once, on the plan.
      expect(text).toContain("The difference is WHEN they are involved")
    }),
  )

  it.instance("describes three phases and derives them from the todo list", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("The three phases")
      expect(text).toContain("PLAN")
      expect(text).toContain("BUILD")
      expect(text).toContain("BLOCKED")
      expect(text).toContain("TODO LIST tells you which")
    }),
  )

  it.instance("the collaborate rule states that looking is ungated", () =>
    Effect.gen(function* () {
      // A mode that asked before reading would be unusable, and would spend the
      // developer's attention on the one decision they do not need to make.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Looking is never gated")
    }),
  )

  it.instance("forbids re-asking what the developer just said", () =>
    Effect.gen(function* () {
      // The ceremonial question. Asked for a README, it replied with
      // ["Create simple README", "Wait, change scope"] -- the second option
      // being "I was wrong about what I just asked for".
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Do NOT ask the developer to re-affirm")
      expect(text).toContain("you do not have a question")
    }),
  )

  it.instance("tells it not to re-confirm what the agreed plan settles", () =>
    Effect.gen(function* () {
      const text = yield* applyFor("collaborate")
      expect(text).toContain("DO NOT ASK ABOUT ANYTHING THE PLAN ALREADY SETTLES")
    }),
  )

  it.instance("defines what earns a mid-build interruption", () =>
    Effect.gen(function* () {
      // The criterion has to be checkable, or "come back when blocked" slides
      // straight back into asking for reassurance. Reality has to have moved.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("unbuildable as")
      expect(text).toContain("whether REALITY MOVED")
      expect(text).toContain("blockedReason")
    }),
  )

  it.instance("requires the confirmation to be a question TOOL call, not prose", () =>
    Effect.gen(function* () {
      // The mode's first real session failed at exactly this point. It assessed
      // correctly, cited the lines, listed one file, said it had no questions,
      // wrote "Confirm: ...?" as TEXT -- and then edited the file in the very
      // next step with no human in between. Prose does not hand control back.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("USE THE QUESTION TOOL, NEVER PROSE")
      expect(text).toContain("halts the loop")
    }),
  )

  it.instance("says what to do when the question tool is unavailable", () =>
    Effect.gen(function* () {
      // Found live: told to "use the question tool" in a context that denies it,
      // the model reached for `task` instead and produced a schema error.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("call NO tool at all")
    }),
  )

  it.instance("demands a decision, not a rubber stamp", () =>
    Effect.gen(function* () {
      // Five of nine questions in one session offered a single option or
      // Proceed/Cancel. The model was obeying a prompt that called the tool call
      // "the confirmation" -- so it confirmed.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("ASK A DECISION, NOT A RUBBER STAMP")
      expect(text).toContain("each PROPOSE")
    }),
  )

  it.instance("says a decline does not count as the second option", () =>
    Effect.gen(function* () {
      // Requiring two options killed the one-option question; the shape came
      // back padded with "Skip" and "Cancel", 14 times across 47 live questions.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("A decline")
      expect(text).toContain("cannot be what makes the count")
    }),
  )

  it.instance("gates destructive shell, and says approval does not cover collateral", () =>
    Effect.gen(function* () {
      // It gated sixteen times on writing files, then force-killed a process it
      // had never named, to free a port for a server it had been asked to start.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("APPROVAL FOR A GOAL IS NOT APPROVAL FOR THE COLLATERAL")
      expect(text).toContain("state OUTSIDE the project directory")
    }),
  )

  it.instance("tells it to believe a reported symptom", () =>
    Effect.gen(function* () {
      // Told "the drop down is no where in sight", it answered "There IS
      // ability -- dropdown is at MessageBubble.jsx:27-36". Reading the source
      // tells you what was written, not what the developer is looking at.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("Believe the observation")
    }),
  )

  it.instance("says to ask the failing surface for its own error", () =>
    Effect.gen(function* () {
      // The CORS session: it tested the backend from PowerShell eight times and
      // called it verified, while the browser had already written the diagnosis
      // in its console. Six steps of server-side reasoning to reach what one
      // question would have produced.
      const text = yield* applyFor("collaborate")
      expect(text).toContain("ASK FOR THAT SURFACE'S OWN ERROR")
      expect(text).toContain("browser console")
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
      expect(text).toContain("The plan you are working to")
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
      expect(text).toContain("PHASE: BLOCKED")
      expect(text.indexOf("run the go backend")).toBeLessThan(text.indexOf("write the react widget"))
    }),
  )

  it.instance("states the empty plan rather than saying nothing", () =>
    Effect.gen(function* () {
      // This test used to assert that NOTHING was injected with an empty list.
      // That left the model inferring "we have not agreed anything yet" from the
      // absence of a message, which is exactly the reasoning this mechanism
      // exists to remove. An empty plan is now said out loud, and it is what
      // puts the session in the PLAN phase.
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
      expect(text).toContain("no todo list for this session yet")
      expect(text).toContain("PHASE: PLAN")
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
      expect(text).not.toContain("The plan you are working to")
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
