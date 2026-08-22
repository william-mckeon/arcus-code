import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"

// Collaborate mode works WITH the developer rather than for them: it does the
// real work, states what it found and what it intends to touch, and then waits
// for a confirmation before changing anything -- even when it is certain.
//
// The gate is the CONFIRMATION, not a withheld tool. That distinction is what
// these tests pin: strip edit away and this becomes plan mode, which is a
// different and already-existing thing.

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Agent.node, Plugin.node, Provider.node, Auth.node, Config.node, Skill.node, RuntimeFlags.node]),
    [[RuntimeFlags.node, RuntimeFlags.layer({})]],
  ),
)

const perm = (agent: Agent.Info | undefined, permission: string): PermissionV1.Action | undefined =>
  agent ? Permission.evaluate(permission, "*", agent.permission).action : undefined

const get = (name: string) => Agent.Service.use((svc) => svc.get(name))

describe("agent.collaborate", () => {
  it.instance("is registered as a primary agent, so it appears in the agent switcher", () =>
    Effect.gen(function* () {
      // The TUI lists any agent whose mode is not "subagent", so being primary
      // is the whole of what makes this reachable by Tab or /agents.
      const agent = yield* get("collaborate")
      expect(agent?.name).toBe("collaborate")
      expect(agent?.mode).toBe("primary")
    }),
  )

  it.instance("can still edit -- the gate is the confirmation, not a missing tool", () =>
    Effect.gen(function* () {
      // If edit were denied this would simply be plan mode. The point of the
      // mode is that it CAN act and chooses to hold.
      const agent = yield* get("collaborate")
      expect(perm(agent, "edit")).toBe("allow")
    }),
  )

  it.instance("allows the question tool, which is the mechanism the gate runs on", () =>
    Effect.gen(function* () {
      // Denied here, the mode cannot ask, and would either stall or just act.
      const agent = yield* get("collaborate")
      expect(perm(agent, "question")).toBe("allow")
    }),
  )

  it.instance("leaves reading ungated", () =>
    Effect.gen(function* () {
      // Looking is free; only changing is gated. Asking before a read would
      // spend the developer's attention on the one thing they need not decide.
      const agent = yield* get("collaborate")
      for (const tool of ["read", "grep", "glob", "tree"]) expect(perm(agent, tool)).toBe("allow")
    }),
  )

  it.instance("has the same capabilities as build", () =>
    Effect.gen(function* () {
      // Any divergence here would mean the mode is quietly weaker than build,
      // and a developer would find that out mid-task rather than up front.
      const collaborate = yield* get("collaborate")
      const build = yield* get("build")
      for (const tool of ["edit", "write", "bash", "task", "webfetch", "read"]) {
        expect(perm(collaborate, tool)).toBe(perm(build, tool))
      }
    }),
  )

  it.instance("is distinct from plan, which cannot edit at all", () =>
    Effect.gen(function* () {
      const collaborate = yield* get("collaborate")
      const plan = yield* get("plan")
      expect(perm(plan, "edit")).toBe("deny")
      expect(perm(collaborate, "edit")).toBe("allow")
    }),
  )

  it.instance("describes itself in terms of the confirmation, not of restriction", () =>
    Effect.gen(function* () {
      // The description is what a developer reads in the agent switcher, and it
      // is the only place the mode explains itself before being used.
      const agent = yield* get("collaborate")
      expect(agent?.description?.toLowerCase()).toContain("confirm")
    }),
  )
})
