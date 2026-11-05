# Builders Bot

**Persistent AI teammates that live on your machine — not in a browser tab.**

Builders Bot is a desktop workspace where every agent gets its own room, its own memory, and its own hands: files, terminal, an embedded browser, and messages to other agents. You bring the model — Codex, Claude, Grok, OpenCode, Gemini, Cursor, or Cline — and Builders Bot gives it a place to actually work.

---

## The idea in 30 seconds

Most AI chats evaporate. Builders Bot treats every agent like a teammate with a desk:

| | |
|---|---|
| 🧑‍💻 **Persistent agents** | Each agent keeps its instructions, workspace, thread, and identity across restarts and even provider switches. |
| 🗂️ **Real workspaces** | Agents read and write files in their own folder on your disk. Nothing lives only in a prompt. |
| 💬 **Channels & delegation** | Put several agents in one channel chat, assign work, and let them answer each other — with a task owner, shared history, and a stop button that actually stops. |
| 🛠️ **Hands** | Queues, file transfers, an embedded persistent browser, optional Computer Use on the desktop. |
| 🏠 **Local-first** | Chats, databases, attachments and browser data stay on your machine. A remote server only coordinates accounts, avatars and invites. |

> [!WARNING]
> Agents run with `danger-full-access` and automatic approvals after an explicit first-launch
> consent. They can modify files, run commands and use the network. Run tasks you trust, keep
> backups, and read [Security](#security).

## Supported providers

| Provider | How it connects |
|---|---|
| Codex (OpenAI) | local App Server |
| Claude Code | local CLI session |
| Grok | local CLI session |
| OpenCode | ACP |
| Gemini | local CLI session |
| Cursor | local CLI session |
| Cline | ACP |
| Any OpenAI-compatible endpoint | custom base URL |

Local model servers (Ollama, LM Studio) are detected automatically.

## Try it

Grab a release from the [releases page](https://github.com/nextlevelcommunity/buildersbot-repo1/releases), or build it yourself — see [Commands](#commands).

Supported systems: macOS 13+ (Apple silicon or Intel), Windows 10+ (x64), Linux (x64/arm64 AppImage).

## Commands

```bash
bun install --frozen-lockfile   # exact Bun 1.4.2 + Node 24 (.nvmrc)
bun run dev                     # run the desktop app against local services
bun run dev:stop                # stop this worktree's stack
```

| Command | What it does |
|---|---|
| `bun run dev` | desktop app + local account service |
| `bun run dev:all` | every background service at once |
| `bun run dev:automation` | drive the app for smoke checks |
| `bun run test:changed` | run only the tests touched by your changes |
| `bun run typecheck:node` | types for main process, backend, scripts |
| `bun run typecheck:renderer` | types for renderer and shared UI |
| `bun run dist:mac` / `dist:win` / `dist:linux` | packaged builds |

## Repository map

```
┌─ apps/               product surfaces
│  ├─ auth-api         account service (Cloudflare Workers + D1)
│  ├─ site-router      hosting for published sites
│  ├─ mobile           iPhone/Android companion (Expo)
│  ├─ chrome-extension builder-side browser bridge
│  └─ status, slack-app, telegram-app, discord-app
├─ packages/           shared code
│  ├─ ui               SolidJS component library
│  ├─ contracts        IPC + Team API protocols
│  ├─ team-client      WebRTC teamwork transport
│  └─ brand, i18n, logging, telemetry, user-errors
├─ remote/             self-hosted Signal/TURN deployment
├─ src/                the Electron desktop app
├─ docker/, infra/, nix, marketplace, tools
```

The monorepo runs on Bun workspaces with pinned versions, `biome` for lint and format, Vitest for tests, and Effect for domain services.

## Security

Builders Bot separates what stays home from what reaches out:

- **On your machine:** conversations, the SQLite database, attachments, browser profile, agent workspaces, keys.
- **Coordinated in the cloud:** accounts, avatars, host configuration, memberships, invitations and logical sessions — never chats, files, or commands.

Every outbound host the app contacts is listed in a closed network policy checked by CI. Secrets are redacted on all log, export and messaging paths. Full details: [PRIVACY.md](PRIVACY.md), [ANALYTICS.md](ANALYTICS.md), [docs/architecture](docs/architecture/agents.md).

## Self-hosting

The account service, published sites, status page, and the signaling server for remote sessions can all run on your own infrastructure. Start with [docs/self-hosting.md](docs/self-hosting.md) and [docs/docker.md](docs/docker.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture change rules](docs/architecture/change-rules.md). Release notes go into `changelog.d/`, and CI enforces the guard checks described in [docs/development-checks.md](docs/development-checks.md).

## License

Proprietary. © 2026 CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA. See [LICENSE](LICENSE).
