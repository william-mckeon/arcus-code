export * as QuestionV1 from "./question"

import { Schema } from "effect"
import { define, inventory } from "../event"
import { ascending } from "../identifier"
import { statics } from "../schema"
import { SessionID } from "../session-id"
import { SessionV1 } from "./session"

export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionID"),
  statics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "que_" + ascending()) })),
)

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
}).annotate({ identifier: "QuestionOption" })

/**
 * Bare declines -- "Cancel", "Skip", "No". Matched WHOLE, never by prefix:
 * "Skip tests" is a real alternative to "Run tests" and has to stay legal. The
 * prefix version of this check would have rejected it.
 */
const DECLINE =
  /^(cancel|skip|no|nope|abort|stop|don'?t|nevermind|never mind|back|exit|quit|hold|hold off|wait|later|not now|leave it|leave as is)[.!]?$/i

/** Options that actually propose doing something, as opposed to backing out. */
export const substantive = (options: ReadonlyArray<{ readonly label: string }>) =>
  options.filter((option) => !DECLINE.test(option.label.trim()))

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  // At least two, because a one-option question is not a question. THIS is the
  // schema the question tool validates against -- the v2 copy beside it is not
  // wired to anything yet, and constraining that one first changed nothing
  // while the tests happily passed against it.
  //
  // Observed live: five of nine questions in one session offered a single
  // option or Proceed/Cancel, and two more slipped through after the v2-only
  // change. The model is doing what it was told -- the mode prompt called the
  // tool call "the confirmation" -- so this makes the rubber stamp
  // unrepresentable rather than merely discouraged.
  // Counting options was not enough. isMinLength(2) killed the one-option
  // question -- zero have appeared since it shipped -- but the shape came back
  // one level up: "Rebuild"/"Skip" and "Proceed"/"Cancel" satisfy the count
  // while leaving exactly one thing the developer can actually choose to do.
  // Across 47 real questions, 14 had this shape. So the rule is two options
  // that PROPOSE something; a decline is still allowed, it just cannot be the
  // second one.
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
  multiple: Schema.optional(Schema.Boolean).annotate({ description: "Allow selecting multiple choices" }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({ description: "Allow typing a custom answer (default: true)" }),
}).annotate({ identifier: "QuestionInfo" })
export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionPrompt" })
export const Tool = Schema.Struct({ messageID: SessionV1.MessageID, callID: Schema.String }).annotate({
  identifier: "QuestionTool",
})
export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({ description: "Questions to ask" }),
  tool: Schema.optional(Tool),
}).annotate({ identifier: "QuestionRequest" })
export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionAnswer" })
export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionReply" })
export const Replied = Schema.Struct({
  sessionID: SessionID,
  requestID: ID,
  answers: Schema.Array(Answer),
}).annotate({
  identifier: "QuestionReplied",
})
export const Rejected = Schema.Struct({ sessionID: SessionID, requestID: ID }).annotate({
  identifier: "QuestionRejected",
})

const Asked = define({ type: "question.asked", schema: Request.fields })
const RepliedEvent = define({ type: "question.replied", schema: Replied.fields })
const RejectedEvent = define({ type: "question.rejected", schema: Rejected.fields })
export const Event = {
  Asked,
  Replied: RepliedEvent,
  Rejected: RejectedEvent,
  Definitions: inventory(Asked, RepliedEvent, RejectedEvent),
}
