export * as Question from "./question"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { SessionID } from "./session-id"
import { statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionV2.ID"),
  statics((schema) => {
    const create = () => schema.make("que_" + ascending())
    return {
      create,
      ascending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
}).annotate({ identifier: "QuestionV2.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

/**
 * Bare declines -- matched WHOLE, never by prefix, so "Skip tests" stays a legal
 * alternative to "Run tests". Kept identical to the v1 copy in v1/question.ts;
 * v1 is what the running tool validates against, and the two drifting apart is
 * how the first version of this constraint shipped with no effect at all.
 */
const DECLINE =
  /^(cancel|skip|no|nope|abort|stop|don'?t|nevermind|never mind|back|exit|quit|hold|hold off|wait|later|not now|leave it|leave as is)[.!]?$/i

/** Options that propose doing something, as opposed to backing out. */
export const substantive = (options: ReadonlyArray<{ readonly label: string }>) =>
  options.filter((option) => !DECLINE.test(option.label.trim()))

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  // At least two, because a one-option question is not a question. Observed
  // live: five of nine questions in one session offered a single option or
  // Proceed/Cancel -- a speed bump with nothing to decide. The model was doing
  // exactly what it was told (the prompt said the call was "the confirmation"),
  // so the wording is fixed too; this makes the rubber stamp unrepresentable
  // rather than merely discouraged.
  //
  // Safe to constrain here: nothing outside the model authors a question. The
  // HTTP API only lists pending ones and accepts answers, plugins only read
  // them, and every in-repo constructor already passes two or more.
  // Counting options was not enough. The one-option question died with
  // isMinLength(2), but the shape returned one level up: "Rebuild"/"Skip" and
  // "Proceed"/"Cancel" satisfy the count while leaving one real path. 14 of 47
  // live questions had that shape. So: two options that PROPOSE something. A
  // decline is still allowed, it just cannot be the second one.
  options: Schema.Array(Option)
    .check(Schema.isMinLength(2))
    .check(
      Schema.makeFilter((options: ReadonlyArray<{ readonly label: string }>) =>
        substantive(options).length >= 2
          ? undefined
          : "needs at least two options that propose an action -- a decline like Cancel or Skip does not count as the second choice, so offer the real alternatives instead",
      ),
    )
    .annotate({ description: "Available choices -- at least two real alternatives, not one action plus Cancel" }),
  // Mirrors the v1 copy in v1/question.ts, which is what the running tool
  // validates against. Constraining only one of the two is how the first
  // version of the options rule shipped with no effect at all.
  //
  // Two rounds of constraining the OPTIONS did not stop the ceremonial
  // question: the shape survived as one option, then one option plus a decline,
  // then two real options for something already specified. The emptiness is not
  // in the options, it is in the absence of a reason -- so the reason is
  // required, and writing it is what exposes when there is none.
  unresolved: Schema.String.check(
    Schema.makeFilter((value: string) =>
      value.trim().length > 0 ? undefined : "state what in the conversation leaves this question open",
    ),
  ).annotate({
    description:
      "What in the conversation leaves this open. Name the gap, not the action: 'nothing specifies which port' is a gap; 'whether to create the README they asked for' is not.",
  }),
  multiple: Schema.Boolean.pipe(optional).annotate({ description: "Allow selecting multiple choices" }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.Boolean.pipe(optional).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}).annotate({ identifier: "QuestionV2.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionV2.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Tool = Schema.Struct({
  messageID: Schema.String,
  callID: Schema.String,
}).annotate({ identifier: "QuestionV2.Tool" })
export interface Tool extends Schema.Schema.Type<typeof Tool> {}

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({ description: "Questions to ask" }),
  tool: Tool.pipe(optional),
}).annotate({ identifier: "QuestionV2.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionV2.Answer" })
export type Answer = typeof Answer.Type

export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionV2.Reply" })
export interface Reply extends Schema.Schema.Type<typeof Reply> {}

const Asked = define({ type: "question.v2.asked", schema: Request.fields })
const Replied = define({
  type: "question.v2.replied",
  schema: {
    sessionID: SessionID,
    requestID: ID,
    answers: Schema.Array(Answer),
  },
})
const Rejected = define({
  type: "question.v2.rejected",
  schema: {
    sessionID: SessionID,
    requestID: ID,
  },
})
export const Event = { Asked, Replied, Rejected, Definitions: inventory(Asked, Replied, Rejected) }
