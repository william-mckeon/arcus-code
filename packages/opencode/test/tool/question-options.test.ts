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
