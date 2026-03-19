# CLAUDE.md — OAuthRouter

## What is this project?

OAuthRouter is an OpenAI-compatible proxy that routes LLM requests across multiple providers (Anthropic, OpenAI, OpenAI Codex, DeepSeek, Google Gemini) with automatic cost optimization, OAuth support, vision-aware routing, and failover. It runs as an OpenClaw plugin or standalone on `localhost:8402`.

**One proxy. Every model. Cheapest path that works.**

## Quick commands

```bash
npm run build          # Compile TS → dist/ (tsup, ESM, node20)
npm run dev            # Watch mode
npm run typecheck      # Type checking only
npm test               # Unit tests (node:test, 45% line coverage threshold)
npm run test:unit      # Same as above
npm run test:integration  # Integration tests
npm run lint           # ESLint
npm run format:check   # Prettier check
```

Tests require a build first (`npm run build --silent` runs automatically via the test script).

## Architecture overview

```
Client (OpenAI SDK) → POST /v1/chat/completions → Proxy (src/proxy.ts)
  → Auth check → Spend controls → Router classifier (14-dim rules)
  → Adapter (provider-specific transform) → Upstream API
  → Response translation → Client
```

### Adapters (`src/adapters/`)

| Adapter           | File              | Provider                   | Key behavior                                                                                                 |
| ----------------- | ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Anthropic**     | `anthropic.ts`    | Claude (Haiku/Sonnet/Opus) | OpenAI↔Messages format conversion, tool_calls↔tool_use, streaming, OAuth auto-refresh, vision                |
| **OpenAI**        | `openai.ts`       | GPT models                 | Minimal pass-through, strips `openai/` prefix                                                                |
| **OpenAI Codex**  | `openai-codex.ts` | ChatGPT Codex              | Converts to `/backend-api/codex/responses`, JWT account ID extraction, SSE mapping via `codex-sse-mapper.ts` |
| **DeepSeek**      | `deepseek.ts`     | DeepSeek Chat/Reasoner     | OpenAI-compatible with field allowlisting, strips `deepseek/` prefix                                         |
| **Google Gemini** | `google.ts`       | Gemini Flash/Pro           | Routes to `generativelanguage.googleapis.com/v1beta/openai`, strips unsupported fields                       |

### Router (`src/router/`)

- **14-dimensional rule-based classifier** in `rules.ts` — scores prompts on code presence, reasoning markers, technical terms, creative markers, simple indicators, multi-step patterns, etc.
- **4 tiers**: SIMPLE → MEDIUM → COMPLEX → REASONING (cheapest to most expensive)
- **Vision override**: images enforce minimum COMPLEX tier
- **Config**: `config.ts` has tier boundaries, dimension weights, model selection per tier
- Runs in <1ms, no ML model needed

### Resilience

- **Rate-limit fallback** (`fallback-config.ts`): On 429/529, tries next provider in chain
- **Provider health** (`provider-health.ts`): Tracks failures with exponential cooldown, background probes
- **Retry** (`retry.ts`): Exponential backoff with Retry-After support
- **Request dedup** (`dedup.ts`): Caches responses 30s to prevent double-charging on retries

### Auth

- **Anthropic OAuth**: Auto-refresh via `claude-oauth-refresh.ts` (reads `~/.claude/.credentials.json`, 5-min buffer)
- **OpenClaw auth profiles**: `openclaw-auth-profiles.ts` resolves credentials from `~/.openclaw/agents/{agentId}/agent/auth-profiles.json`
- **API keys**: DeepSeek and Google use standard Bearer token auth

## Key files

- `src/proxy.ts` — Main HTTP server (~2600 lines), all endpoint handling
- `src/router/` — Routing engine (classifier, config, model selector)
- `src/adapters/` — Provider-specific request/response transforms
- `src/fallback-config.ts` — Fallback chain definitions (single source of truth)
- `src/spend-controls.ts` — Token budget enforcement
- `scripts/openclaw-proxy.mjs` — Main proxy runner script
- `test/unit/` — Unit tests (one per adapter + router + utilities)

## Conventions

- **TypeScript strict mode**, ESM output, target ES2022
- **Test framework**: Node's native `node:test` + `node:assert/strict` (no external test deps)
- **Build**: tsup (single bundle, sourcemaps, .d.ts generation)
- **Model IDs**: Prefixed with provider (`anthropic/claude-sonnet-4-6`, `openai-codex/gpt-5.2`, `google/gemini-2.5-flash`). Adapters strip the prefix before upstream calls.
- **Config files**: `config.local.json` holds secrets (gitignored). `openclaw.plugin.json` defines plugin schema.

## Environment variables

| Variable                  | Default   | Purpose               |
| ------------------------- | --------- | --------------------- |
| `OAUTHROUTER_PORT`        | 8402      | Server port           |
| `OAUTHROUTER_LISTEN_HOST` | 127.0.0.1 | Bind address          |
| `OAUTHROUTER_LOCAL_TOKEN` | (random)  | Proxy auth token      |
| `DEEPSEEK_API_KEY`        | —         | DeepSeek provider key |
| `GOOGLE_API_KEY`          | —         | Google provider key   |

## Current branch context

Branch `feat/google-gemini-fallback` adds Google Gemini as a fallback provider (ROUTER-018), including the Google adapter, fallback chain integration, and field stripping fixes.
