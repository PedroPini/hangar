# Security policy

Hangar reads capability files from your projects and your home directory across
several AI tools. It is read-only by design: it does not install, edit, move, or
delete capabilities, and the only file it ever writes is its own shortcut
config at `~/.config/hangar/config.json`.

That makes the security surface small but specific, and the sections below
describe what it is.

## Supported versions

Hangar is pre-1.0. Only the latest release receives fixes; there are no
backports to earlier tags. Upgrade before reporting, in case the issue is
already fixed on `main`.

## Reporting a vulnerability

Report privately through GitHub — open the repository's **Security** tab and
choose **Report a vulnerability**. That opens a private advisory visible only to
the maintainers.

Please do not open a public issue for anything that lets someone read files
outside a project, execute code, or write to disk.

Include the version or commit, your operating system and Node version, and the
smallest capability tree that reproduces the problem. A tarball of a directory
layout that triggers it is worth more than a description of one.

Expect an acknowledgement within a few days. Hangar is maintained by one person,
so fixes are best-effort; you will get an honest timeline rather than an
optimistic one. Once a fix ships, you will be credited in the advisory unless
you would rather not be.

## What is in scope

The threat model worth taking seriously is a **hostile repository**: you clone
someone's project and run `hangar` inside it. Anything in that situation that
escapes the intended boundaries is a vulnerability.

- Escaping the discovered capability roots — through symlinks, `..` components,
  or path handling — and reading files elsewhere on the machine.
- Any write, move, or delete of a file. Hangar is read-only; a crafted tree
  causing it to modify anything is a bug regardless of how minor the change is.
- Resource exhaustion that a crafted tree can trigger: symlink cycles, very deep
  nesting, huge metadata files, or pathological search behaviour that hangs the
  process.
- Terminal escape sequence injection, where crafted capability metadata is
  rendered into the picker and manipulates the user's terminal.
- Command or argument injection reaching the clipboard integration or the
  `hangar-editor` seam.
- File contents or paths appearing in `--json` output or the picker that were
  never meant to be exposed.

## What is not in scope

- Hangar displaying metadata from capability files you already have installed.
  Reading and summarising those files is the entire purpose of the tool.
- Malicious skills or agents themselves. Hangar reports what is on disk; it does
  not install, execute, or vouch for any capability it lists, and deciding
  whether a capability is trustworthy is out of its hands.
- Vulnerabilities in Node.js. Report those upstream, though do tell us if Hangar
  requires an affected version.
- Discovery gaps — a capability that does not appear, or appears with the wrong
  scope. Those are ordinary bugs; please open a normal issue with the output of
  `hangar doctor`.

## Design constraints that exist for security

If you are auditing Hangar, these are deliberate and should not be relaxed
without a good reason:

- Symlinks are followed only when the resolved target is inside a directory
  Hangar already searches, so a link pointing out of a capability root is
  skipped rather than followed.
- Metadata files are capped at 1 MiB, and a single scan has a 256 MiB total
  metadata budget. Both limits exist so that a crafted tree cannot exhaust
  memory, whether through one enormous file or a great many ordinary ones.
- Project scanning stops at the repository boundary rather than walking to the
  filesystem root.
- Hangar has no runtime dependencies, so there is no third-party code in the
  install and no transitive supply chain to audit.
