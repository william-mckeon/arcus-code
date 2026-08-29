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

/**
 * The current todo list, restated each turn.
 *
 * This is a LIST, not a state machine. An earlier version derived a plan/build/
 * blocked phase from it and told the model which one it was in; the blocked
 * phase never fired once in any live session, and neither did the transitions.
 * The model follows prose and hard schema rejections, and does not drive
 * machinery it has to operate itself -- `tree` sat at 2% of calls, `todowrite`
 * at 0.8%. What survives is the part that needed no cooperation: putting the
 * list in front of it every turn.
 *
 * Blocked tasks come first and carry their reason, because a blocked task is
 * the only kind that needs someone else to decide something.
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
  const blocked = todos.filter((t) => t.status === "blocked").length
  return [
    "<system-reminder>",
    "# Your current todo list",
    "",
    "Restated because nothing else keeps it in front of you once earlier turns",
    "are summarised away. Do not ask about anything it already settles.",
    "",
    ...lines,
    "",
    blocked > 0 ? "A task is BLOCKED. State the fact that blocked it and what you need decided." : undefined,
    "</system-reminder>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
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
  // The mode carries build's capabilities and differs only in what it says
  // while working: what it found, what it is about to do, and what it could not
  // verify. A synthetic user part lands after the system prompt, so re-stating
  // it each turn keeps it from being worn down over a long session.
  //
  // It no longer carries a gate. "Confirm before changing anything, even when
  // certain" produced 16 questions against 20 edits in one real session, most
  // of them asking the developer to re-affirm what they had just said, and no
  // measurement ever showed it improving what was produced.
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
    // Nothing to say when there is no list. The phase model injected an
    // "empty plan" notice here so the model could infer which phase it was in;
    // with the phases gone that is just noise on every early turn.
    if (todos.length > 0) {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: renderTodos(todos),
        synthetic: true,
      })
    }
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
