/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeArcusCodeContent from "./skill/customize-arcus-code.md" with { type: "text" }

export const CustomizeArcusCodeContent = customizeArcusCodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-arcus-code",
            // The config filenames below are literal paths on disk, not branding.
            // They still read "opencode" because the filesystem namespace has not
            // been renamed yet — keep them accurate until it is.
            description:
              "Use ONLY when the user is editing or creating Arcus Code's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing Arcus Code agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring Arcus Code itself.",
            location: AbsolutePath.make("/builtin/customize-arcus-code.md"),
            content: CustomizeArcusCodeContent,
          }),
        }),
      )
    })
  }),
})
