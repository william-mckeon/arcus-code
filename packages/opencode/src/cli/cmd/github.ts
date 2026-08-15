import { Brand } from "@opencode-ai/core/brand"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"

export { extractResponseText, formatPromptTooLargeError, parseGitHubRemote } from "./github.shared"

/**
 * The GitHub agent is built entirely on upstream infrastructure: it looks up
 * installations against api.opencode.ai, authenticates as the `opencode-agent`
 * GitHub App, and writes a workflow that runs `anomalyco/opencode/github`.
 * None of that is ours to use, and the App would be acting on repositories in
 * somebody else's name.
 *
 * Gated behind the same flag as self-update — both are cases of a fork reaching
 * for services it does not own. Re-enable once Arcus publishes its own Action
 * and App, and repoint the handler at them.
 */
const unavailable = () =>
  Effect.sync(() => {
    UI.empty()
    UI.println(
      `The GitHub agent runs on upstream opencode's App and Action, which ${Brand.name} does not own.`,
    )
    UI.println(`It is disabled until ${Brand.name} publishes its own.`)
    UI.empty()
  })

export const GithubInstallCommand = effectCmd({
  command: "install",
  describe: "install the GitHub agent",
  handler: () =>
    Effect.gen(function* () {
      if (!Brand.selfUpdate) return yield* unavailable()
      const { githubInstall } = yield* Effect.promise(() => import("./github.handler"))
      return yield* githubInstall()
    }),
})

export const GithubRunCommand = effectCmd({
  command: "run",
  describe: "run the GitHub agent",
  builder: (yargs) =>
    yargs
      .option("event", {
        type: "string",
        describe: "GitHub mock event to run the agent for",
      })
      .option("token", {
        type: "string",
        describe: "GitHub personal access token (github_pat_********)",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      if (!Brand.selfUpdate) return yield* unavailable()
      const { githubRun } = yield* Effect.promise(() => import("./github.handler"))
      return yield* githubRun(args)
    }),
})

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
