<p align="center">Arcus Code</p>
<p align="center">The AI coding agent for the terminal — built on the open source opencode engine, the way macOS is built on Darwin.</p>

---

### Status

Arcus Code is pre-release and not yet distributed. There is no published npm package, Homebrew formula or install script yet, so the only supported way to run it is from this repository.

Build the binary for your platform:

```bash
bun install
cd packages/opencode && bun run script/build.ts --single --skip-install
```

Then run it:

```bash
./dist/opencode-windows-x64/bin/opencode.exe        # Windows
./dist/opencode-darwin-arm64/bin/opencode           # macOS
```

Or run from source without building:

```bash
bun run dev
```

> [!NOTE]
> The compiled binary is still named `opencode` and stores its data in the
> `opencode` namespace (`~/.local/share/opencode`, `opencode.json`, `OPENCODE_*`).
> Renaming those is a breaking change tracked separately from the user-facing
> rebrand — see the rename map before touching them.

### Agents

Arcus Code includes two built-in agents you can switch between with the `Tab` key.

- **build** — default, full-access agent for development work
- **plan** — read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

### Documentation

Arcus Code has no docs site yet. Configuration, hooks, slash commands, skills and
MCP setup are inherited from the engine and documented at
[opencode.ai/docs](https://opencode.ai/docs) — the behavior described there is the
behavior you get.

### Relationship to opencode

Arcus Code is a downstream product built on [opencode](https://github.com/anomalyco/opencode).
It is not affiliated with or endorsed by the opencode project. Some identifiers
deliberately keep the upstream name because they are protocol values rather than
branding — the `opencode` provider ID, the `X-Title` attribution headers sent to
third-party gateways, and the OTLP service name. Do not rename those.

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
