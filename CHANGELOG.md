# Changelog

All notable changes to Builders Bot are documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md).

## [Unreleased]

## [1.0.0] - 2026-11-02

First public release of Builders Bot under Cultura Builder.

### Added

- Desktop app for macOS, Windows and Linux, with agents that run on this computer or on a server.
- Local-first workspace: the agents, the conversations and the database stay on the machine that runs
  them; the account is central.
- Builders, Codex, Claude, Grok and custom providers, each with its own model and reasoning level.
- Channels with a lead and members, tasks, routines, workflows, a schedule, a marketplace and a
  shared browser.
- Remote access with a paired phone or another computer, and published sites on our zone.

### Changed

- The product, the package scopes, the file names, the headers, the environment variables and the
  network hosts are ours. The license is our EULA with a commercial license per seat.
- The profile folder, the database file and the workspace state folder of an installation made
  before this version are moved on first run, so an upgrade keeps the account, the agents and the
  chats.
