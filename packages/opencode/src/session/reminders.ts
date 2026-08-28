import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { Todo } from "./todo"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"
import COLLABORATE from "./prompt/collaborate.txt"

export type CollaboratePhase = "plan" | "build" | "blocked"

/**
 * Which phase collaborate mode is in, derived from the todo list.
 *
 * The list IS the stored state, rather than a separate flag beside it. A flag
 * would be a second source of truth that can disagree with the plan it
 * describes, and the alternative -- inferring agreement from the conversation --
 * turns a one-word reply like "ok" into a phase transition, which is exactly the
 * fragile reading this avoids.
 *
 *   no todos, or every task pending  -> plan     nothing agreed yet
 *   any in_progress or completed     -> build    work is underway
 *   any blocked                      -> blocked  something needs deciding
 *
 * Marking the first task in_progress is therefore what "we agreed" looks like in
 * storage, and it is an action the model already has to take to work the list.
 */
export function phaseOf(todos: ReadonlyArray<Todo.Info>): CollaboratePhase {
  if (todos.some((t) => t.status === "blocked")) return "blocked"
  if (todos.some((t) => t.status === "in_progress" || t.status === "completed")) return "build"
  return "plan"
}

const PHASE_NOTE: Record<CollaboratePhase, string> = {
  plan:
    "PHASE: PLAN. Nothing is agreed yet. Find out what you genuinely do not know, ask only about that, then write the plan as a todo list and ask once whether it matches what they want.",
  build:
    "PHASE: BUILD. The plan is agreed. Work the list down without stopping to ask. Do not re-confirm anything the list already settles. Mark tasks in_progress and completed as you go.",
  blocked:
    "PHASE: BLOCKED. A task cannot continue until something is decided. State the fact that blocked it and the real alternatives you can see, then carry on once they answer.",
}

/** No plan yet. Said explicitly rather than left as silence. */
function renderEmptyPlan(): string {
  return [
    "<system-reminder>",
    "# The plan you are working to",
    "",
    "There is no todo list for this session yet, so nothing has been agreed.",
    "",
    PHASE_NOTE.plan,
    "</system-reminder>",
  ].join("\n")
}

/**
 * The agreed plan, as the model sees it each turn.
 *
 * Blocked tasks are listed first and carry their reason, because a blocked task
 * is the only kind that needs a decision, and a decision is the only thing worth
 * interrupting the developer for.
 */
function renderTodos(todos: ReadonlyArray<Todo.Info>): string {
  const mark: Record<string, string> = {
    completed: "[x]",
    in_progress: "[~]",
    blocked: "[!]",
    cancelled: "[-]",
    pending: "[ ]",
  }
  const order = (t: Todo.Info) => (t.status === "blocked" ? 0 : 1)
  const lines = [...todos]
    .sort((a, b) => order(a) - order(b))
    .map((t) => {
      const reason = t.status === "blocked" && t.blockedReason ? `  <- blocked: ${t.blockedReason}` : ""
      return `${mark[t.status] ?? "[ ]"} ${t.content}${reason}`
    })
  return [
    "<system-reminder>",
    "# The plan you are working to",
    "",
    "This is the current todo list for this session, restated because nothing",
    "else keeps it in front of you once earlier turns are summarised away.",
    "",
    ...lines,
    "",
    PHASE_NOTE[phaseOf(todos)],
    "</system-reminder>",
  ].join("\n")
}

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const todoService = yield* Todo.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  // Collaborate mode, injected on every turn rather than once on entry.
  //
  // The rule it carries -- confirm before changing anything, even when certain
  // -- is the opposite of what the system prompt says, which tells the model
  // never to ask for confirmation. A synthetic user part lands after the system
  // prompt, so re-stating it each turn is what keeps it from being worn down by
  // the surrounding instruction over a long session.
  //
  // Independent of experimentalPlanMode: this mode has nothing to do with plan
  // files, and must behave the same under either branch below.
  if (input.agent.name === "collaborate") {
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: COLLABORATE,
      synthetic: true,
    })

    // The todo list, re-stated every turn.
    //
    // There is no read tool: `todowrite` writes and nothing reads back, so the
    // model only knew its own list because the tool RESULT echoed the JSON into
    // the conversation. That copy is summarised away by compaction, which is
    // exactly when a long build most needs to know what was already agreed.
    // Injecting costs no tool call, is always current, and survives compaction.
    //
    // Measured before building this: 9 todowrite calls out of 1158 tool calls
    // in real sessions, 0.8%. A tool that only writes builds no habit.
    const todos = yield* todoService.get(input.session.id).pipe(Effect.orElseSucceed(() => []))
    // Injected even when the list is empty, because an empty list is itself the
    // signal that nothing has been agreed yet. Without it the model has to infer
    // the phase from the absence of a message, which is the kind of reasoning
    // this whole mechanism exists to remove.
    userMessage.parts.push({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: todos.length > 0 ? renderTodos(todos) : renderEmptyPlan(),
      synthetic: true,
    })
  }
  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        synthetic: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const ctx = yield* InstanceState.context
  const plan = Session.plan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
    ),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionReminders from "./reminders"
