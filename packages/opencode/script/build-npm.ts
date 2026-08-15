#!/usr/bin/env bun
/**
 * Assembles the installable npm package from the compiled platform binaries.
 *
 * Split out of publish.ts, which interleaved assembly with pushing to npm, AUR,
 * Homebrew and GHCR — all of them upstream's. Building the artifact and
 * releasing it are separate decisions and should be separate commands.
 *
 * Layout produced, matching what npm expects for a binary CLI:
 *
 *   dist/arcus-code/
 *     package.json      wrapper, one optionalDependency per platform
 *     postinstall.mjs   picks the right platform package and copies its binary
 *     bin/arcus-code.exe  placeholder that errors if postinstall never ran
 *     LICENSE
 *
 * Run `bun run script/build.ts` first. With --single only the current platform
 * is compiled, which is enough to install and test locally but not to publish.
 */
import { $ } from "bun"
import pkg from "../package.json"
import { fileURLToPath } from "url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const platform = await Bun.file(`./dist/${filepath}`).json()
  // Skip the wrapper itself if a previous run left one behind.
  if (platform.name === pkg.name) continue
  binaries[platform.name] = platform.version
}

if (Object.keys(binaries).length === 0) {
  console.error("No platform binaries in ./dist — run `bun run script/build.ts` first.")
  process.exit(1)
}

const version = Object.values(binaries)[0]
const root = `./dist/${pkg.name}`

await $`rm -rf ${root}`
await $`mkdir -p ${root}/bin`
await $`cp ./script/postinstall.mjs ${root}/postinstall.mjs`
await Bun.file(`${root}/LICENSE`).write(await Bun.file("../../LICENSE").text())

// Placeholder binary. npm installs with --ignore-scripts, and pnpm skips
// postinstall by default, so without this the command silently does nothing.
await Bun.file(`${root}/bin/${pkg.name}.exe`).write(
  [
    `echo "Error: ${pkg.name}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${pkg.name} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${pkg.name} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`${root}/package.json`).write(
  JSON.stringify(
    {
      // Upstream published as `opencode-ai` because `opencode` was taken. That
      // constraint is not ours — `arcus-code` is free, so no suffix.
      name: pkg.name,
      description: "The AI coding agent for the terminal",
      bin: { [pkg.name]: `./bin/${pkg.name}.exe` },
      scripts: { postinstall: "node ./postinstall.mjs" },
      version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

console.log(`assembled ${root}`)
console.log(`  name     ${pkg.name}@${version}`)
console.log(`  binaries ${Object.keys(binaries).length}`)
for (const name of Object.keys(binaries)) console.log(`           ${name}`)
if (Object.keys(binaries).length < 12) {
  console.log("")
  console.log("Not every platform is present — this package installs only where a binary exists.")
  console.log("Run `bun run script/build.ts` without --single before publishing.")
}
