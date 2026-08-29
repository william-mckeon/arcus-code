import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters } from "../../src/tool/question"

// This goes through the QUESTION TOOL's own Parameters, not through a schema
// chosen by hand. The first attempt at this constraint was applied to
// schema/src/question.ts (QuestionV2), which nothing is wired to; the tests
// passed against it while two single-option questions sailed through a live
// session. Reaching the constraint the way the model reaches it is the only
// version of this test worth having.

const ask = (options: Array<{ label: string; description: string }>) =>
  Schema.decodeUnknownPromise(Parameters)({
    questions: [{ question: "Where should this go?", header: "Placement", options }],
  }).then(
    () => true,
    () => false,
  )

const option = (label: string) => ({ label, description: `choose ${label}` })

describe("question tool parameters", () => {
  test("a real choice is accepted", async () => {
    expect(await ask([option("Inside the input"), option("Above the input")])).toBe(true)
  })

  test("a single option is rejected", async () => {
    // The exact shape seen live: "Confirm: rebuild Docker?" -> one option.
    expect(await ask([option("docker-compose up -d --build")])).toBe(false)
  })

  test("Proceed on its own is rejected", async () => {
    expect(await ask([option("Remove label")])).toBe(false)
  })

  test("no options at all is rejected", async () => {
    expect(await ask([])).toBe(false)
  })

  test("three or four options are fine", async () => {
    expect(await ask([option("A"), option("B"), option("C")])).toBe(true)
    expect(await ask([option("A"), option("B"), option("C"), option("D")])).toBe(true)
  })

  test("every question in a batch is checked, not just the first", async () => {
    // A batched call must not smuggle a rubber stamp in behind a good question.
    const mixed = await Schema.decodeUnknownPromise(Parameters)({
      questions: [
        { question: "Where?", header: "Placement", options: [option("A"), option("B")] },
        { question: "Proceed?", header: "Confirm", options: [option("Proceed")] },
      ],
    }).then(
      () => true,
      () => false,
    )
    expect(mixed).toBe(false)
  })

  test("the rejection names the constraint so the model can correct itself", async () => {
    // A tool-call failure is fed back to the model. An opaque message just gets
    // retried identically.
    const message = await Schema.decodeUnknownPromise(Parameters)({
      questions: [{ question: "Proceed?", header: "Confirm", options: [option("Proceed")] }],
    }).then(
      () => "accepted",
      (error) => String(error).toLowerCase(),
    )
    expect(message).not.toBe("accepted")
    expect(message).toMatch(/length|minimum|2|item/)
  })
})

// Requiring two options killed the one-option question outright -- none has
// appeared since it shipped. The shape came back one level up: pad to two with
// "Cancel" and the count is satisfied while the developer still has exactly one
// thing they can choose to do. 14 of 47 real questions had that shape.
describe("question tool parameters - a decline is not the second choice", () => {
  test("Proceed / Cancel is rejected", async () => {
    expect(await ask([option("Proceed"), option("Cancel")])).toBe(false)
  })

  test("Rebuild / Skip is rejected", async () => {
    // Verbatim from a live Inkling-Small turn -- passed the count, still a button.
    expect(await ask([option("Rebuild"), option("Skip")])).toBe(false)
  })

  test("an action plus several declines is still rejected", async () => {
    expect(await ask([option("Proceed full redesign"), option("Cancel"), option("No")])).toBe(false)
  })

  test("two real alternatives plus a decline are accepted", async () => {
    // Offering a way out is fine -- it just cannot BE the alternative.
    expect(await ask([option("Modernize the dropdown"), option("Move it above the input"), option("Cancel")])).toBe(true)
  })

  test("the real question from the same session is accepted", async () => {
    // Verbatim, the good one: two genuine placements, one with a line number.
    expect(
      await ask([
        option("Center header title only (App.jsx:265)"),
        option("Center the whole main content differently"),
      ]),
    ).toBe(true)
  })

  test("Proceed / Hold is rejected", async () => {
    // The one miss in an otherwise clean 16-question session: "Hold" is a way
    // out dressed as an option. Same shape as Proceed/Cancel.
    expect(await ask([option("Proceed"), option("Hold")])).toBe(false)
  })

  test("the other deferral words are declines too", async () => {
    expect(await ask([option("Apply the change"), option("Wait")])).toBe(false)
    expect(await ask([option("Apply the change"), option("Later")])).toBe(false)
    expect(await ask([option("Apply the change"), option("Not now")])).toBe(false)
    expect(await ask([option("Apply the change"), option("Leave as is")])).toBe(false)
  })

  test("a decline WORD inside a real choice is not a decline", async () => {
    // The reason DECLINE matches whole labels and never prefixes: "Skip tests"
    // proposes an action. A prefix match would reject this and teach the model
    // that a legitimate choice is illegal.
    expect(await ask([option("Skip tests"), option("Run tests")])).toBe(true)
    expect(await ask([option("No-cache rebuild"), option("Incremental rebuild")])).toBe(true)
    expect(await ask([option("Stop the container"), option("Restart the container")])).toBe(true)
    // The widened list must not eat these either.
    expect(await ask([option("Hold the connection open"), option("Close after each call")])).toBe(true)
    expect(await ask([option("Wait for the build"), option("Return immediately")])).toBe(true)
    expect(await ask([option("Leave it running"), option("Tear it down")])).toBe(true)
  })

  test("declines are matched regardless of case and trailing punctuation", async () => {
    expect(await ask([option("Apply the change"), option("cancel")])).toBe(false)
    expect(await ask([option("Apply the change"), option("Cancel.")])).toBe(false)
    expect(await ask([option("Apply the change"), option("  Skip  ")])).toBe(false)
  })

  test("the rejection explains what to offer instead", async () => {
    const message = await Schema.decodeUnknownPromise(Parameters)({
      questions: [{ question: "Proceed?", header: "Confirm", options: [option("Proceed"), option("Cancel")] }],
    }).then(
      () => "accepted",
      (error) => String(error).toLowerCase(),
    )
    expect(message).not.toBe("accepted")
    expect(message).toMatch(/decline|cancel|propose|alternative/)
  })
})
