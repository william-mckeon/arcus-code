import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { FileSystem } from "../src/filesystem"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Pty } from "../src/pty"
import { Question } from "../src/question"
import { Session } from "../src/session"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { optional } from "../src/schema"

describe("contract hygiene", () => {
  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
  })

  // This test used to be called "todo status and priority preserve arbitrary
  // strings" and asserted that status "waiting" and priority "urgent" decoded
  // happily. That was the loose contract recorded as though it were a feature:
  // both fields were Schema.String with the legal values named only in the
  // description, so nothing rejected a status the rest of the system cannot
  // render or reason about. Same shape as the question schema that accepted a
  // one-option question for weeks.
  test("todo status and priority accept only the values the system understands", () => {
    const decode = (todo: unknown) => {
      try {
        Schema.decodeUnknownSync(SessionTodo.Info)(todo)
        return "accepted"
      } catch {
        return "rejected"
      }
    }
    expect(decode({ content: "ship", status: "waiting", priority: "urgent" })).toBe("rejected")
    expect(decode({ content: "ship", status: "pending", priority: "high" })).toBe("accepted")
    expect(decode({ content: "ship", status: "done", priority: "high" })).toBe("rejected")
  })

  test("a blocked todo can carry the reason it is blocked", () => {
    // The state the other four could not express. Without it, a plan that has
    // hit an obstacle is indistinguishable from one still being worked.
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(
      decode({ content: "run the backend", status: "blocked", priority: "high", blockedReason: "go is not installed" }),
    ).toEqual({
      content: "run the backend",
      status: "blocked",
      priority: "high",
      blockedReason: "go is not installed",
    })
  })

  test("blockedReason is optional, so unblocked todos are unchanged", () => {
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(decode({ content: "ship", status: "pending", priority: "low" })).toEqual({
      content: "ship",
      status: "pending",
      priority: "low",
    })
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Api,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("current source avoids Any and mutable contract wrappers", async () => {
    const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
      (file) => !file.endsWith("-v1.ts"),
    )
    const source = await Promise.all(
      files.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
    ).then((values) => values.join("\n"))

    expect(source).not.toContain("Schema.Any")
    expect(source).not.toContain("Schema.mutable")
  })
})
