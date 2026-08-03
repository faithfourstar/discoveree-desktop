# Discoveree Desktop

**A local, agent-maintained context layer for your product, served over MCP to any AI tool.**

Discoveree keeps a structured, always-fresh picture of your product world — strategy, competitors, customers and feedback, and your product's own feature inventory — maintained by agents and served over the Model Context Protocol to whatever AI tools you already use: Claude, Cursor, ChatGPT, or your own agents.

> **Status: pre-alpha.** The desktop edition is under active development and not yet ready for use. The build plan lives in [docs/build-brief.md](docs/build-brief.md).

## Why

AI tools are only as good as the context they're given. Prose documents rewritten by prompts silently accumulate duplicates and drift. Discoveree holds product context as a typed, validated schema — stable IDs, provenance, confidence, freshness accounting — kept current by deterministic pipelines (hash-diff changelog monitoring, help-centre crawling, review mining), and serves it to every tool and teammate from one source of truth.

- **Your data stays local.** Competitive and roadmap data never leaves your machine.
- **Bring your own LLM keys.** One key from any major provider is enough.
- **Any AI tool connects.** Local MCP over stdio and localhost HTTP.
- **Judgment, not just storage.** A weekly, evidence-cited review of whether your roadmap is building the most valuable things — with suggestions you can accept into Jira or Linear.

## Structure

```
client/   React SPA (shared by desktop and team deployments)
server/   Express server — embedded in the desktop app, deployable shared for teams
shared/   Schema and types (Drizzle + Zod)
docs/     Build brief and design docs
```

One codebase, two deployments: the desktop app embeds the server with a local database; the team tier deploys the same server shared. Local/team is a deployment target, not a fork.

## Licence

[Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md) (FSL-1.1-ALv2): source-available — you can read, run, and modify the code for any non-competing purpose, and each version becomes Apache 2.0 licensed two years after release.
