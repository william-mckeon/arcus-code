import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Question } from "../src/question"

// The v2 question schema, which NOTHING is wired to yet -- the running tool
// validates against QuestionV1 (packages/schema/src/v1/question.ts).
//
// That distinction cost a release: the constraint was added here first, these
// tests passed, and two single-option questions went straight through a live
// session because the model never touches this schema. The test that actually
// guards the behaviour is packages/opencode/test/tool/question-options.test.ts,
// which goes through the tool's own Parameters.
//
// Kept so v2 carries the same rule the day it is wired up.
const option = (label: string) => ({ label, description: `pick ${label}` })

const decode = (options: Array<{ label: string; description: string }>) =>
  Schema.decodeUnknownEffect(Question.Prompt)({
    question: "Where should the dropdown go?",
    header: "Placement",
    unresolved: "nothing in the request specifies where this goes",
    options,
  })

const accepts = async (options: Array<{ label: string; description: string }>) =>
  Schema.decodeUnknownPromise(Question.Prompt)({
    question: "Where should the dropdown go?",
    header: "Placement",
    unresolved: "nothing in the request specifies where this goes",
    options,
  }).then(
    () => true,
    () => false,
  )

describe("Question.Prompt options", () => {
  test("a real choice is accepted", async () => {
    expect(await accepts([option("Inside the input"), option("Above the input")])).toBe(true)
  })

  test("three options are accepted", async () => {
    // The best question in the observed session offered exactly this shape.
    expect(await accepts([option("Chat area"), option("Input box"), option("Each bubble")])).toBe(true)
  })

  test("a single option is rejected", async () => {
    // "Confirm: move to ChatInput?" -> ["Move to ChatInput"]. Nothing to decide.
    expect(await accepts([option("Move to ChatInput")])).toBe(false)
  })

  test("no options at all is rejected", async () => {
    expect(await accepts([])).toBe(false)
  })

  test("the failure names the constraint, so the model can correct itself", async () => {
    // A tool-call rejection is fed back to the model, so the message has to say
    // what was wrong; an opaque failure would just get retried identically.
    const result = await Schema.decodeUnknownPromise(Question.Prompt)({
      question: "Proceed?",
      header: "Confirm",
      unresolved: "nothing in the request specifies this",
      options: [option("Proceed")],
    }).then(
      () => "accepted",
      (error) => String(error),
    )
    expect(result).not.toBe("accepted")
    expect(result.toLowerCase()).toMatch(/length|minimum|2|item/)
  })

  test("decode preserves the options it accepts", async () => {
    const decoded = await Schema.decodeUnknownPromise(Question.Prompt)({
      question: "Where?",
      header: "Placement",
      unresolved: "nothing in the request specifies where",
      options: [option("A"), option("B")],
    })
    expect(decoded.options.map((o) => o.label)).toEqual(["A", "B"])
  })

  test("Info carries the same constraint as Prompt", async () => {
    // Info is what the server and TUI exchange; if only Prompt were constrained
    // a single-option question could still reach the UI by another path.
    const one = await Schema.decodeUnknownPromise(Question.Info)({
      question: "Proceed?",
      header: "Confirm",
      unresolved: "nothing in the request specifies this",
      options: [option("Proceed")],
    }).then(
      () => true,
      () => false,
    )
    expect(one).toBe(false)
  })
})

// The note that used to sit here said a schema cannot enforce that the
// alternatives are meaningful, and left it to the prompt. That was half right.
// The prompt did not hold: 14 of 47 live questions padded to two options with a
// decline -- "Proceed"/"Cancel", "Rebuild"/"Skip" -- satisfying the count with
// one real path. A decline being a decline IS mechanically checkable, so it is
// checked here now. What still belongs to the prompt is whether two genuinely
// different actions are the RIGHT two.
describe("Question.Prompt options - a decline is not the second choice", () => {
  test("Proceed / Cancel is rejected", async () => {
    expect(await accepts([option("Proceed"), option("Cancel")])).toBe(false)
  })

  test("Rebuild / Skip is rejected", async () => {
    expect(await accepts([option("Rebuild"), option("Skip")])).toBe(false)
  })

  test("two real alternatives plus a decline are accepted", async () => {
    expect(await accepts([option("Modernize the dropdown"), option("Move it above the input"), option("Cancel")])).toBe(
      true,
    )
  })

  test("Proceed / Hold is rejected", async () => {
    expect(await accepts([option("Proceed"), option("Hold")])).toBe(false)
  })

  test("a decline word inside a real choice is not a decline", async () => {
    // Whole-label matching, never prefix: "Skip tests" proposes an action.
    expect(await accepts([option("Skip tests"), option("Run tests")])).toBe(true)
    expect(await accepts([option("Stop the container"), option("Restart the container")])).toBe(true)
    expect(await accepts([option("Hold the connection open"), option("Close after each call")])).toBe(true)
    expect(await accepts([option("Leave it running"), option("Tear it down")])).toBe(true)
  })

  test("Info carries the decline rule too", async () => {
    // Same reason Info carries the min-length rule: otherwise a rubber stamp
    // reaches the UI by the other path.
    const rubber = await Schema.decodeUnknownPromise(Question.Info)({
      question: "Proceed?",
      header: "Confirm",
      unresolved: "nothing in the request specifies this",
      options: [option("Proceed"), option("Cancel")],
    }).then(
      () => true,
      () => false,
    )
    expect(rubber).toBe(false)
  })
})

// Guard against the constraint being satisfied in letter but not spirit -- what
// a schema still cannot enforce is that the two actions are the right two.
describe("Question.Prompt shape", () => {
  test("an option needs both a label and a description", async () => {
    const missing = await Schema.decodeUnknownPromise(Question.Prompt)({
      question: "Where?",
      header: "Placement",
      unresolved: "nothing in the request specifies where",
      options: [{ label: "A" }, { label: "B" }],
    }).then(
      () => true,
      () => false,
    )
    expect(missing).toBe(false)
  })
})

void decode
