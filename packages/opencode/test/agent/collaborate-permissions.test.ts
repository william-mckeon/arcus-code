import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

// Collaborate gated sixteen times on writing files and then force-killed a
// process it had never mentioned:
//
//   say:  "Python blocking port 8080. Killing it to free port for requested backend."
//   bash: Stop-Process -Id 51432 -Force        <- no question tool call before it
//
// The prompt already said destructive shell was gated. It was read as a step
// toward an approved goal instead of a decision of its own, so the rule needed
// a backstop that does not depend on the model classifying it correctly.
//
// These tests exist because the patterns are the fragile part: `evaluate` runs
// Wildcard.match(command, rule.pattern) with findLast, so a pattern that is too
// narrow silently never fires and a pattern that is too broad stops everything.

const it = testEffect(
  LayerNode.compile(LayerNode.group([Agent.node, Permission.node, FSUtil.node, RuntimeFlags.node, CrossSpawnSpawner.node])),
)

const ruleFor = (agent: Agent.Info, command: string) => Permission.evaluate("bash", command, agent.permission).action

const collaborate = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const list = yield* agents.list()
  const found = list.find((a) => a.name === "collaborate")
  expect(found).toBeDefined()
  return found!
})

describe("collaborate destructive-shell backstop", () => {
  it.instance("asks before killing a process", () =>
    Effect.gen(function* () {
      const agent = yield* collaborate
      // The exact command from the session.
      expect(ruleFor(agent, "Stop-Process -Id 51432 -Force")).toBe("ask")
      expect(ruleFor(agent, "taskkill /PID 51432 /F")).toBe("ask")
      expect(ruleFor(agent, "kill -9 51432")).toBe("ask")
    }),
  )

  it.instance("asks inside a compound command, not just at the start", () =>
    Effect.gen(function* () {
      // Also from the session: the destructive verb was mid-line, which is why
      // the patterns are *verb* and not verb*.
      const agent = yield* collaborate
      expect(ruleFor(agent, "docker rm -f calc-backend; docker ps -a | Select-String 'calc'")).toBe("ask")
      expect(ruleFor(agent, "cd backend; Stop-Process -Id 9 -Force")).toBe("ask")
    }),
  )

  it.instance("asks before irreversible git and filesystem commands", () =>
    Effect.gen(function* () {
      const agent = yield* collaborate
      expect(ruleFor(agent, "git reset --hard origin/main")).toBe("ask")
      expect(ruleFor(agent, "git clean -fdx")).toBe("ask")
      expect(ruleFor(agent, "git push --force origin main")).toBe("ask")
      expect(ruleFor(agent, "rm -rf build")).toBe("ask")
      expect(ruleFor(agent, "Remove-Item -Path dist -Recurse -Force")).toBe("ask")
      expect(ruleFor(agent, "docker system prune -af")).toBe("ask")
    }),
  )

  it.instance("leaves ordinary work alone", () =>
    Effect.gen(function* () {
      // The whole point of collaborate is that it CAN act. A backstop that made
      // every command ask would turn it into a permission prompt generator, and
      // the developer would click through them without reading -- which costs
      // more safety than it buys.
      const agent = yield* collaborate
      expect(ruleFor(agent, "docker build -t calculator-backend ./backend")).toBe("allow")
      expect(ruleFor(agent, "docker ps --filter name=calc-test")).toBe("allow")
      expect(ruleFor(agent, "npm run dev")).toBe("allow")
      expect(ruleFor(agent, "go run main.go")).toBe("allow")
      expect(ruleFor(agent, "git status --porcelain")).toBe("allow")
      expect(ruleFor(agent, "git commit -m 'wip'")).toBe("allow")
      expect(ruleFor(agent, "ls -la")).toBe("allow")
    }),
  )

  it.instance("does not confuse docker rm with docker run", () =>
    Effect.gen(function* () {
      // `docker run` and `docker rmi` sit either side of this line; getting it
      // wrong would either block every container start or wave through image
      // deletion.
      const agent = yield* collaborate
      expect(ruleFor(agent, "docker run -d --name calc-test -p 8081:8080 calculator-backend")).toBe("allow")
      expect(ruleFor(agent, "docker rm -f calc-test")).toBe("ask")
    }),
  )

  it.instance("build mode is unaffected", () =>
    Effect.gen(function* () {
      // The backstop belongs to collaborate, whose whole contract is that the
      // developer is at the decision. Build never promised that and should not
      // silently change behaviour.
      const agents = yield* Agent.Service
      const build = (yield* agents.list()).find((a) => a.name === "build")
      expect(build).toBeDefined()
      expect(ruleFor(build!, "Stop-Process -Id 51432 -Force")).toBe("allow")
    }),
  )
})
