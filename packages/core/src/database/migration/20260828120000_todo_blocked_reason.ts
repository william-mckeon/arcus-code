import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

/**
 * Add `todo.blocked_reason`.
 *
 * The todo statuses were pending, in_progress, completed and cancelled. None of
 * them says "this cannot continue until someone decides something", so a plan
 * that had hit an obstacle looked identical to one still being worked. The
 * obstacle was only visible if the model happened to narrate it in prose, which
 * is exactly the kind of thing that gets summarised away.
 *
 * `blocked` is now a status, and this is where its reason lives. Persisted
 * rather than kept in the conversation because the point of a blocked task is
 * that someone returns to it later, and later is when the turn that explained
 * it is gone.
 *
 * Nullable and additive: every existing row is valid with NULL, and nothing
 * reads the column unless a task is blocked. Checked against live data before
 * writing this -- 25 rows, statuses completed/in_progress/pending only, so no
 * value rewriting is needed and this migration only widens the table.
 *
 * SQLite ALTER TABLE ADD COLUMN is a metadata-only operation on a nullable
 * column with no default, so this does not rewrite the table.
 */
export default {
  id: "20260828120000_todo_blocked_reason",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`todo\` ADD COLUMN \`blocked_reason\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
