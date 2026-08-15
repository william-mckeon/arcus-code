ARCUS CODE FILE CHANGE LIST
Based on full session review (message by message, folder by folder, file by file)
Identity: Arcus = macOS layer; OpenCode/Darwin = base at ...\Open code ai\opencode
Rule: Arcus identity = "I am Arcus" when asked who it is.

DELETED (completed):
- README.ar.md
- README.bn.md
- README.br.md
- README.bs.md
- README.da.md
- README.de.md
- README.es.md
- README.fr.md
- README.gr.md
- README.it.md
- README.ja.md
- README.ko.md
- README.no.md
- README.pl.md
- README.ru.md
- README.th.md
- README.tr.md
- README.uk.md
- README.vi.md
- README.zh.md
- README.zht.md

RESTORED (kept):
- README.md

UPDATED (need identity changes for Arcus):
Root folder:
- package.json (name: opencode -> arcus; repo URL -> arcus)
- .opencode/opencode.jsonc (references to opencode-local path, schema, identity)
- .opencode/agent/duplicate-pr.md (mentions opencode/claude-haiku)
- .opencode/agent/triage.md (team names reference core/opencode)
- .opencode/tui.json (plugin references)

packages/opencode:
- package.json (name: opencode -> arcus)
- src/agent/agent.ts (agent definitions: build/plan/general names/descriptions; Service @opencode/Agent)
- src/agent/generate.txt (agent generation prompt references project identity)
- src/agent/prompt/*.txt (explore, compaction, summary, title identity prompts)
- src/cli/cmd/account.ts (console.opencode.ai URL)
- src/cli/logo.ts (logo identity export)

packages/core:
- package.json (name: @opencode-ai/core -> @arcus/core or similar)

ADDED (for Arcus identity):
- ARCUS_IDENTITY.md (or .opencode/arcus-identity.json) defining: "When a user asks who you are, respond: I am Arcus."
- Optional: .opencode/agent/arcus.md (Arcus-specific agent identity)

NOT CHANGED / KEPT (Darwin base layer intact):
- packages/core/src/ (full source kept)
- packages/protocol/, packages/server/, packages/client/
- All copied OpenCode files except those listed above for identity update
- .gitignore, .husky/, .vscode/, patches/, perf/, nix/, artifacts/, github/
- All 32 package folders (core, protocol, server, cli, etc.) kept

NOTE: Identity edits executed for root, .opencode/, packages/opencode/agent/config, packages/core/package.json, README.md. Actual line-by-line edits inside remaining .ts files (core/src/ service tags, protocol/, client/, desktop/, app/, web/, ui/) require additional passes.
