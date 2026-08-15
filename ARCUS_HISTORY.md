# Arcus Code — pre-fork change history

The repository was re-initialised on 2026-08-15 to sever it from the
`anomalyco/opencode` clone it grew out of. That discarded the git history, so
the commit messages are preserved here — they carry the reasoning for changes
that are not self-evident from the code, several of which cost real debugging
to find.

Highlights worth keeping in mind:

- The self-updater resolved against upstream's npm package and silently
  replaced the running binary with upstream opencode.
- Directory adoption must fail loudly; swallowing a blocked move produced a
  split install that looked exactly like data loss.
- Database filenames included the release channel, which for an unpublished
  fork is the git branch — so every branch got its own session history.
- Bun on Windows breaks Node's recursive-mkdir contract on OneDrive-synced
  directories, which silently broke every plugin dependency install.

---

904691e64310331299f3d8394f4100b8d07f2deb
2026-08-15 12:56:34 -0400
fix(npm): restore Node's recursive mkdir contract for arborist

Node guarantees mkdir(path, { recursive: true }) is a no-op when path already
exists. Under Bun on Windows that does not hold for directories OneDrive has
synced — they throw EEXIST. Every directory in a synced checkout reproduces
it; freshly created directories elsewhere do not. Same family as
oven-sh/bun#21901, which FSUtil.ensureDir already works around for our own
calls.

@npmcli/arborist calls mkdir on its own target at the top of reify(), so
every background dependency install failed and project plugins never received
their dependencies. The warning appeared on all 26 runs recorded in the log.

The shim is installed on import rather than wrapped around the call, because
arborist destructures the function at module load:

  const { lstat, mkdir, rm, symlink } = require('node:fs/promises')

A call-site patch is captured too late to matter — verified by writing one
first and watching it change nothing.

Narrow by construction: only recursive: true, and only when the path really is
an existing directory, so a file blocking a directory still errors.

Verified: three runs from source and one from the compiled binary add zero
warnings, and .opencode/node_modules now contains the packages that had never
installed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
c923e2abaffef127d4dc8b797cefec972e2737a1
2026-08-15 12:48:09 -0400
fix(database): stop giving every git branch its own session history

The database filename included the release channel, and for an unpublished
fork the channel is whatever branch the build was cut from. Building on dev
wrote arcus-code-dev.db, a feature branch wrote arcus-code-<branch>.db, and
running from source wrote arcus-code-local.db — so sessions vanished on
checkout and no branch build could see the history in arcus-code.db.

That split exists so upstream's beta testers cannot corrupt a stable
database, which only makes sense for a project shipping parallel channels.
Gated behind the same flag that tracks whether we publish at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
0f4a7f9e46b1f00efb723a029ff6be41ab0739ac
2026-08-15 12:38:36 -0400
fix(npm): bind the install lock to the operation it guards

reify took its lock with flock.acquire, which needs a Scope from the caller
and lives only as long as that scope. `add` wraps itself in Effect.scoped;
`install` does not, so installs held a lock that provided no mutual exclusion
and two of them could enter arborist for the same directory at once.

withLock binds the lock to the body instead, so a caller cannot reintroduce
this by forgetting to scope.

This does not fix the EEXIST warning on background dependency installs —
that reproduces with the lock working correctly, so serialization was not
the cause. It is a separate, pre-existing defect.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
d6a2370069f8adefd161c631994a857fdd6ef25c
2026-08-15 11:11:31 -0400
fix(github): stop reaching for upstream's App, Action and CI

The GitHub agent runs entirely on infrastructure this fork does not own: it
resolves installations against api.opencode.ai, authenticates as the
`opencode-agent` GitHub App, and generates a workflow running
anomalyco/opencode/github. Acting on a user's repositories under somebody
else's App identity is not something to leave reachable, so it is gated
behind the same flag as self-update and explains itself instead.

Also removes 24 workflows that fire on push, on cron, or on pull_request_target
against repositories and cloud accounts belonging to upstream — publishing to
npm and AUR, deploying SST stacks, closing issues, syncing docs. Only test and
typecheck are kept, and both are switched off Blacksmith's paid runners, which
this repository has no subscription to and where they would queue forever.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
b8bffcc88ede8d2230f47313a1bd9f2ceb84ed80
2026-08-15 09:46:41 -0400
docs: drop the localized READMEs

These were deleted from the working tree earlier but never committed, and
the language navigation in README.md linked to all of them. Translating
upstream's README into 21 languages is not work this fork carries.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
bc1dea10a374713c06c9cd899a7715cf11f6d7e4
2026-08-15 09:46:26 -0400
feat(build): ship the binary as arcus-code

The executable was still called opencode. The name was hardcoded separately
in the build outfile, the bin shim, postinstall and the install script, so
renaming the package did not reach it — the same duplicated-constant shape
that made the wordmark miss the rename. All four now derive from pkg.name.

Also bumps the release version from our own package rather than from
registry.npmjs.org/opencode-ai, which meant an Arcus release took whatever
number upstream last published.

The @opencode-ai/* package namespace is deliberately untouched. It is the
engine's own namespace, and renaming it across 1192 files would dissolve the
boundary this fork depends on — macOS does not rename xnu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
26c02d75f1ef105194d950780b9d62f71b5e1d81
2026-08-15 09:46:13 -0400
fix(installation): stop updating into upstream opencode

The auto-updater resolved against upstream's npm package and Homebrew
formula. On a dev-channel build it found opencode-ai on the `dev` tag,
installed it globally, and replaced the running Arcus binary with upstream
opencode — unprompted, and with an older build than the one it replaced.

Every path is now gated behind Brand.selfUpdate, which stays false until
Arcus publishes artifacts of its own. The upgrade command explains that
instead of acting.

The same applies to uninstall, which ran eleven package-manager commands
naming upstream's package. Since install-method detection works by looking
for an installed opencode-ai, those commands would have removed somebody
else's install.

Restores the console URL. That host is opencode zen's OAuth endpoint, not
branding — pointing it elsewhere breaks sign-in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
734156e3e1b3fcb54f174f49d2819c1f0f3aec62
2026-08-15 09:45:59 -0400
feat(core): move the filesystem namespace to arcus-code

Relocates the data directory, config filenames, database, project marker and
skill version stamp. Pre-rename names stay readable so existing installs and
projects keep working; legacy entries sort first in merge lists so an Arcus
file wins, and last in first-match lookups so new files take the new name.

Adds directory adoption on startup. Moving the directory alone is not enough:
the databases inside are named after the old slug, one per release channel,
each with SQLite sidecars. Missing them opens a blank database beside a full
one, which reads to a user as deleted history.

A blocked move now refuses to start rather than continuing. Swallowing it and
carrying on produced exactly one split install during development — a running
process held the databases, the rename failed, startup created empty
directories, and credentials ended up stranded on one side with a blank
database on the other. Refusing is the only outcome that cannot be mistaken
for data loss.

Adoption also runs sequentially. A concurrent batch could move some
directories and not others, which is the state hardest to recover from.

Core's test preload now isolates XDG. Without it a test run reaches into the
developer's real data directory and renames it out from under a live install.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
d967d220e55c626193d679779dd494b97597f633
2026-08-15 09:45:41 -0400
feat(session): give the agent an Arcus Code identity

Puts the identity in the ten system prompts, which is the only place it can
actually take effect. A root-level markdown file describing it is read by
nothing.

Also stops identity questions triggering a web request. The inherited rule
told the model to fetch the docs whenever a user "asks in second person",
which caught "who are you" — so asking the agent its own name produced a
round-trip to the upstream vendor's site. That was coherent upstream, where
the product and the docs are the same thing. Here it means an identity
question leaves the machine and comes back branded as something else.

Feature and configuration questions may still consult the engine docs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
4eae070c8e24553ddf200f67b33fe77df4016972
2026-08-15 09:45:27 -0400
feat(tui): rebrand the user-visible surface to Arcus Code

Redraws the wordmark as "arcus code" and renames the CLI, its help text and
the terminal title. The wordmark existed in three hand-maintained copies, so
the first rebuild still printed "opencode" — the glyphs now have one source
and the plain-text variant is derived from it rather than transcribed.

The gap between the two coloured halves is now a named constant. It was one
cell, matching the spacing between letters, which read as "arcuscode" once
the split no longer fell inside a single word.

The capital A needs all three of its parts: a closed base reads as B, and
dropping the crossbar reads as n.

Also reverts three earlier edits that pointed at things which do not exist:
console.arcus.code (no such TLD), an `arcus` model provider (unregistered),
and a data directory the engine never writes to.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
9fdf2c750c1051ac44629a8fb31eabd83c7c41f5
2026-08-15 09:45:11 -0400
feat(core): add Brand as the single source of product identity

Arcus Code is built on the opencode engine, and the two namespaces have to
coexist: what a user reads is ours, what a server compares against is not.
Scattering that distinction across call sites is how a rename half-applies,
so it lives in one module with the reasoning attached.

`legacy` values are read-only fallbacks so existing installs keep working.
`upstream` values are wire identifiers — the opencode provider ID, the
X-Title attribution headers, the OTLP service name. Renaming those would
deregister this client from third-party gateways while rebranding nothing a
user can see.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

---
