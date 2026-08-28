export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"

/**
 * `blocked` is the state the other four could not express: work that cannot
 * continue until someone decides something. Without it a plan that has hit an
 * obstacle looks identical to one still in progress, so the obstacle is only
 * visible if the model happens to narrate it.
 */
export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled", "blocked"]).annotate({
  description:
    "Current status. Use `blocked` when the task cannot proceed until a decision is made, and say why in blockedReason.",
})
export type Status = typeof Status.Type

export const Priority = Schema.Literals(["high", "medium", "low"]).annotate({
  description: "Priority level of the task",
})
export type Priority = typeof Priority.Type

// status and priority were Schema.String, with the legal values named only in
// the description. Nothing rejected a status of "done" or "banana", so the
// constraint was documentation. That is the same shape as the question schema
// that accepted a one-option question for weeks: a rule the model is told about
// but the schema does not hold it to. Checked against live data before
// constraining -- 25 rows, all four documented statuses, no migration needed.
export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Status,
  priority: Priority,
  blockedReason: Schema.optional(Schema.String).annotate({
    description: "Required when status is `blocked`: the fact that stopped this task, stated plainly.",
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
