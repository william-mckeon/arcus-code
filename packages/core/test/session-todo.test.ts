import { describe, expect } from "bun:test"
import { asc } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionTodo.node])))
const sessionID = SessionV2.ID.make("ses_todo_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("SessionTodo", () => {
  it.effect("replaces persisted todos in order and publishes updates", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const todos = yield* SessionTodo.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTodo.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* todos.update({
        sessionID,
        todos: [
          { content: "second", status: "pending", priority: "low" },
          { content: "first", status: "in_progress", priority: "high" },
        ],
      })
      expect(yield* todos.get(sessionID)).toEqual([
        { content: "second", status: "pending", priority: "low" },
        { content: "first", status: "in_progress", priority: "high" },
      ])
      expect(
        (yield* db.select().from(TodoTable).orderBy(asc(TodoTable.position)).all().pipe(Effect.orDie)).map((row) => ({
          content: row.content,
          position: row.position,
        })),
      ).toEqual([
        { content: "second", position: 0 },
        { content: "first", position: 1 },
      ])

      yield* todos.update({ sessionID, todos: [{ content: "replacement", status: "completed", priority: "medium" }] })
      expect(yield* todos.get(sessionID)).toEqual([{ content: "replacement", status: "completed", priority: "medium" }])

      yield* todos.update({ sessionID, todos: [] })
      expect(yield* todos.get(sessionID)).toEqual([])
      expect(published.map((event) => event.data)).toEqual([
        {
          sessionID,
          todos: [
            { content: "second", status: "pending", priority: "low" },
            { content: "first", status: "in_progress", priority: "high" },
          ],
        },
        { sessionID, todos: [{ content: "replacement", status: "completed", priority: "medium" }] },
        { sessionID, todos: [] },
      ])
    }),
  )

  // A blocked task is the one kind that needs a decision, so the reason it is
  // blocked has to outlive the turn that discovered it. Held in the message it
  // would be summarised away, and the task would come back as an unexplained
  // stop. Both the write mapping and the read mapping have to carry it: the
  // column can exist and the field still vanish, silently, if either side drops
  // it. This asserts the whole round trip rather than the column.
  it.effect("a blocked todo keeps the reason it is blocked, through storage", () =>
    Effect.gen(function* () {
      yield* setup
      const todos = yield* SessionTodo.Service

      yield* todos.update({
        sessionID,
        todos: [
          { content: "run the go backend", status: "blocked", priority: "high", blockedReason: "go is not installed" },
          { content: "write the react widget", status: "pending", priority: "medium" },
        ],
      })

      expect(yield* todos.get(sessionID)).toEqual([
        { content: "run the go backend", status: "blocked", priority: "high", blockedReason: "go is not installed" },
        { content: "write the react widget", status: "pending", priority: "medium" },
      ])
    }),
  )

  it.effect("clears the reason when a task stops being blocked", () =>
    Effect.gen(function* () {
      // Otherwise a task that was unblocked keeps an explanation that no longer
      // applies, which reads to anyone later as a task still waiting on it.
      yield* setup
      const todos = yield* SessionTodo.Service

      yield* todos.update({
        sessionID,
        todos: [{ content: "run the backend", status: "blocked", priority: "high", blockedReason: "no toolchain" }],
      })
      yield* todos.update({
        sessionID,
        todos: [{ content: "run the backend", status: "in_progress", priority: "high" }],
      })

      expect(yield* todos.get(sessionID)).toEqual([
        { content: "run the backend", status: "in_progress", priority: "high" },
      ])
    }),
  )
})
