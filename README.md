<p align="center">Arcus Code</p>
<p align="center">The AI coding agent for the terminal, built on the open source opencode engine the way macOS is built on Darwin.</p>

---

### Status

Pre-release. Nothing is published to npm, Homebrew or anywhere else yet, so you
build it from this repository.

### Build

```bash
bun install
cd packages/opencode
bun run script/build.ts --single --skip-install --skip-embed-web-ui
```

Produces `dist/arcus-code-<platform>/bin/arcus-code`.

| Flag | Effect |
| --- | --- |
| `--single` | Only your platform, instead of all 12 targets |
| `--skip-install` | Don't re-fetch cross-platform native dependencies |
| `--skip-embed-web-ui` | Skip the web UI bundle. Omit it if you want `arcus-code web` |

A full `bun run build` compiles all 12 targets and is only needed to publish.
Cross-compiling every target from one machine is unreliable; the baseline and
musl variants in particular expect artifacts that are awkward to fetch.

### Install

**Windows**

```powershell
.\install.ps1
```

Copies the binary to `~\.arcus-code\bin` and adds it to your user PATH. Open a
new terminal and `arcus-code` works from anywhere.

```powershell
.\install.ps1 -InstallDir D:\tools\arcus   # somewhere else
.\install.ps1 -NoModifyPath                # copy only, leave PATH alone
.\install.ps1 -Binary D:\builds\arcus-code.exe
```

**macOS and Linux**

```bash
./install --binary packages/opencode/dist/arcus-code-darwin-arm64/bin/arcus-code
```

Installs to `~/.arcus-code/bin` and appends to your shell profile. The download
paths in that script point at releases that do not exist yet, so `--binary` is
the only mode that works today.

### Run from source

No build required, and the fastest loop while developing:

```bash
bun run dev
```

### Packaging for npm

```bash
bun run build          # all 12 targets
bun run build:npm      # assembles dist/arcus-code/
```

`build:npm` produces the installable wrapper package. It warns if platform
binaries are missing rather than quietly building something that installs
nowhere. Publishing is deliberately a separate step and is not wired up.

### Agents

Two built-in agents, switched with `Tab`:

- **build** — default, full access
- **plan** — read-only. Denies edits, asks before running commands. Good for
  exploring an unfamiliar codebase.

A **general** subagent handles complex searches and multi-step work; invoke it
with `@general`.

### Where things live

| | |
| --- | --- |
| Data, sessions, credentials | `~/.local/share/arcus-code` |
| Config | `arcus-code.json`, `arcus-code.jsonc`, `.arcus-code/` |
| Logs | `~/.local/share/arcus-code/log/arcus-code.log` |

Pre-rename names (`opencode.json`, `.opencode/`, the old data directory) are
still read, so existing projects keep working. New files use the current names.

### Documentation

There is no Arcus Code docs site yet. Configuration, hooks, slash commands,
skills and MCP setup are inherited from the engine and documented at
[opencode.ai/docs](https://opencode.ai/docs) — the behavior described there is
the behavior you get.

### Relationship to opencode

Arcus Code is a downstream product built on
[opencode](https://github.com/anomalyco/opencode), and is not affiliated with or
endorsed by that project.

Some identifiers deliberately keep the upstream name because they are wire
values rather than branding: the `opencode` provider ID, the `X-Title`
attribution headers sent to third-party gateways, and the OTLP service name.
The `@opencode-ai/*` package namespace is unchanged for the same reason — it is
the engine's own namespace. See `packages/core/src/brand.ts`, which is the
single source for what is ours and what is not.

Self-update and the GitHub agent are disabled. Both resolve against upstream's
npm package, Homebrew tap and GitHub App, so leaving them on meant Arcus Code
could replace itself with opencode. They re-enable via `Brand.selfUpdate` once
Arcus publishes its own.

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
