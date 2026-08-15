# Contributing to Hangar

Thanks for taking a look. Hangar is small on purpose, and the constraints below
are most of what makes it small — reading them first will save you a rewrite.

## Getting set up

Hangar needs Node.js 22 or newer. There is no build step and nothing to install:

```sh
git clone https://github.com/PedroPini/hangar.git
cd hangar
node cli.mjs
```

Run it against a project other than the one you are sitting in with `--project`:

```sh
node cli.mjs --project /path/to/project
node cli.mjs doctor --project /path/to/project   # every directory being searched
node cli.mjs list --json                         # machine-readable catalog
```

Before opening a pull request:

```sh
pnpm check
```

That syntax-checks each module and runs the test suite. It is the same command
CI runs, so a green `pnpm check` locally means a green build.

## The constraints

These are not style preferences. Each one is load-bearing, and a change that
breaks one will be sent back even if the feature is good.

**No runtime dependencies. Ever.** This is the important one. Hangar's install
is a handful of `.mjs` files, its Homebrew formula is a few lines instead of a
vendored `node_modules`, and it has no transitive supply chain for anyone to
audit. Adding a single dependency costs all three. If you need something a
dependency would give you, write the small version of it or open an issue to
discuss whether the feature is worth the price.

**Hangar is read-only.** It does not install, edit, move, or delete
capabilities. The only file it writes is `~/.config/hangar/config.json`. A
feature that needs to modify a capability belongs in a different tool.

**Hangar does not invent data.** Everything shown comes from a file that exists
on disk. No usage history, no trigger-clash detection, no categories, no token
estimates — none of that is knowable from the filesystem, and guessing at it
would make the output untrustworthy for the cases where it matters.

**Symlinks stay contained.** A symlink is followed only when its resolved target
lands inside a directory Hangar already searches. This is what stops a hostile
repository from reading arbitrary files, so it is not a bug to be fixed even
when a legitimate symlink is skipped because of it.

**The stdout/stderr split is a contract.** The picker draws on stderr and prints
only the selected reference on stdout, so `ref=$(hangar)` works in a script.
Printing anything else to stdout breaks every such caller.

**`list --json` is an API.** Other tools consume those field names. Adding
fields is fine; renaming or removing them is a breaking change and needs to be
called out in the pull request.

## Adding a host adapter

The most useful contribution is usually support for another AI tool. Discovery
lives in `catalog.mjs`, and an adapter is a description of where that host keeps
its skills, agents, and plugins.

Hangar treats `.agents/skills` as the portable, cross-client convention and adds
per-host locations on top of it. If the host you are adding reads `.agents`
already, say so in the pull request — that path needs no adapter at all.

Include in your pull request: where the host documents those locations, whether
they are project-scoped, global, or both, and a test covering the layout.

## Tests

Tests live in `test/hangar.test.mjs` and run with the built-in Node test runner:

```sh
node --test
```

They build their own capability trees in a temporary directory rather than
reading a checked-in corpus, which is why they are safe to run anywhere and why
CI needs no fixtures. Follow that pattern for new tests — `test-fixtures/` is a
local-only scratch area and is deliberately gitignored, so nothing in it can be
relied on.

A bug fix should come with a test that fails before it and passes after.

## Pull requests

Keep changes focused; one concern per pull request reviews far faster than a
batch. Match the surrounding code style — two-space indentation, double quotes,
ESM throughout. There is no linter, so consistency comes from reading the file
you are editing.

Explain *why* in the description. The what is visible in the diff; the reasoning
is the part that gets lost.

If you are planning something large, open an issue first. Hangar says no to
features fairly often, and it is better to hear that before you have written it.

## Releases

Releases are cut by the maintainer. The process is documented in the README.
