<div align="center">

# ClawRouter

**Save 78% on LLM costs. Automatically.**

Route every request to the cheapest model that can handle it.
One wallet, 30+ models, zero API keys.

[![npm](https://img.shields.io/npm/v/@blockrun/clawrouter.svg)](https://npmjs.com/package/@blockrun/clawrouter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

[Docs](https://blockrun.ai/docs) &middot; [Models](https://blockrun.ai/models) &middot; [Telegram](https://t.me/blockrunAI) &middot; [X](https://x.com/BlockRunAI)

</div>

---

```
"What is 2+2?"            → Gemini Flash    $0.60/M    saved 99%
"Summarize this article"   → DeepSeek Chat   $0.42/M    saved 99%
"Build a React component"  → Claude Opus     $75.00/M   best quality
"Prove this theorem"       → o3              $8.00/M    saved 89%
```

ClawRouter is a smart LLM router for [OpenClaw](https://github.com/openclaw/openclaw). It classifies each request, picks the cheapest model that can handle it, and pays per-request via [x402](https://x402.org) USDC micropayments on Base. No account, no API key — your wallet signs each payment.

## Quick Start

```bash
# 1. Install — auto-generates a wallet on Base
openclaw plugin install @blockrun/clawrouter

# 2. Fund your wallet with USDC on Base (address printed on install)
#    A few dollars is enough to start — each request costs fractions of a cent

# 3. Enable smart routing
openclaw config set model blockrun/auto
```

Every request now routes to the cheapest capable model.

Already have a funded wallet? Bring your own: `export BLOCKRUN_WALLET_KEY=0x...`

Want a specific model instead? `openclaw config set model openai/gpt-4o` — you still get x402 payments and usage logging.

## How Routing Works

Hybrid rules-first approach. 14 weighted scoring dimensions classify ~80% of requests in <1ms at zero cost. Only low-confidence queries hit the LLM classifier.

```
Request → Weighted scorer (14 dimensions, < 1ms, free)
            ├── Confident → pick model → done
            └── Low confidence → LLM classifier (~200ms, ~$0.00003)
                                   └── classify → pick model → done
```

### Weighted Scoring Engine

14 dimensions, each scored in [-1, 1] and multiplied by a learned weight:

| Dimension | Weight | Signal |
|-----------|--------|--------|
| Reasoning markers | 0.18 | "prove", "theorem", "step by step" |
| Code presence | 0.15 | "function", "async", "import", "```" |
| Simple indicators | 0.12 | "what is", "define", "translate" |
| Multi-step patterns | 0.12 | "first...then", "step 1", numbered lists |
| Technical terms | 0.10 | "algorithm", "kubernetes", "distributed" |
| Token count | 0.08 | short (<50) vs long (>500) |
| Creative markers | 0.05 | "story", "poem", "brainstorm" |
| Question complexity | 0.05 | 4+ question marks |
| Constraint count | 0.04 | "at most", "O(n)", "maximum" |
| Imperative verbs | 0.03 | "build", "create", "implement" |
| Output format | 0.03 | "json", "yaml", "schema" |
| Domain specificity | 0.02 | "quantum", "fpga", "genomics" |
| Reference complexity | 0.02 | "the docs", "the api", "above" |
| Negation complexity | 0.01 | "don't", "avoid", "without" |

Weighted score maps to a tier via configurable boundaries. Confidence is calibrated using a sigmoid function — distance from the nearest tier boundary determines how sure the classifier is.

| Tier | Primary Model | Output $/M | vs Opus |
|------|--------------|-----------|-----------|
| SIMPLE | gemini-2.5-flash | $0.60 | **99% cheaper** |
| MEDIUM | deepseek-chat | $0.42 | **99% cheaper** |
| COMPLEX | claude-opus-4 | $75.00 | best quality |
| REASONING | o3 | $8.00 | **89% cheaper** |

Special override: 2+ reasoning markers → REASONING at 0.97 confidence, regardless of other dimensions.

### LLM Classifier Fallback

When confidence is below the threshold (0.70), ClawRouter sends the first 500 characters to `gemini-2.5-flash` with `max_tokens: 10` and asks for one word: SIMPLE, MEDIUM, COMPLEX, or REASONING. Cost per classification: ~$0.00003. Results cached for 1 hour.

### Estimated Savings

| Tier | % of Traffic | Output $/M |
|------|-------------|-----------|
| SIMPLE | 40% | $0.60 |
| MEDIUM | 30% | $0.42 |
| COMPLEX | 20% | $75.00 |
| REASONING | 10% | $8.00 |
| **Weighted avg** | | **$16.17/M — 78% savings vs Claude Opus** |

Every routed request logs its decision:

```
[ClawRouter] deepseek-chat (MEDIUM, rules, confidence=0.82)
             Cost: $0.0004 | Baseline: $0.0713 | Saved: 99.4%
```

## Models

30+ models across 5 providers, all through one wallet:

| Model | Input $/M | Output $/M | Context | Reasoning |
|-------|----------|-----------|---------|:---------:|
| **OpenAI** | | | | |
| gpt-5.2 | $1.75 | $14.00 | 400K | * |
| gpt-5-mini | $0.25 | $2.00 | 200K | |
| gpt-5-nano | $0.05 | $0.40 | 128K | |
| gpt-4o | $2.50 | $10.00 | 128K | |
| gpt-4o-mini | $0.15 | $0.60 | 128K | |
| o3 | $2.00 | $8.00 | 200K | * |
| o3-mini | $1.10 | $4.40 | 128K | * |
| o4-mini | $1.10 | $4.40 | 128K | * |
| **Anthropic** | | | | |
| claude-opus-4.5 | $15.00 | $75.00 | 200K | * |
| claude-sonnet-4 | $3.00 | $15.00 | 200K | * |
| claude-haiku-4.5 | $1.00 | $5.00 | 200K | |
| **Google** | | | | |
| gemini-3-pro-preview | $2.00 | $12.00 | 1M | * |
| gemini-2.5-pro | $1.25 | $10.00 | 1M | * |
| gemini-2.5-flash | $0.15 | $0.60 | 1M | |
| **DeepSeek** | | | | |
| deepseek-chat | $0.28 | $0.42 | 128K | |
| deepseek-reasoner | $0.28 | $0.42 | 128K | * |
| **xAI** | | | | |
| grok-3 | $3.00 | $15.00 | 131K | * |
| grok-3-fast | $5.00 | $25.00 | 131K | * |
| grok-3-mini | $0.30 | $0.50 | 131K | |

Full list in [`src/models.ts`](src/models.ts).

## Payment

No account. No API key. Payment IS authentication via [x402](https://x402.org).

```
Request → 402 (price: $0.003) → wallet signs USDC → retry → response
```

USDC stays in your wallet until the moment each request is paid — non-custodial. The price is visible in the 402 response before your wallet signs.

**Funding your wallet** — send USDC on Base to your wallet address:
- Coinbase — buy USDC, send to Base
- Any CEX — withdraw USDC to Base
- Bridge — move USDC from any chain to Base

## Usage Logging

Every routed request is logged as a JSON line:

```
~/.openclaw/blockrun/logs/usage-2026-02-03.jsonl
```

```json
{"timestamp":"2026-02-03T20:15:30.123Z","model":"google/gemini-2.5-flash","cost":0.000246,"latencyMs":1250}
```

## Configuration

### Override Routing

```yaml
# openclaw.yaml
plugins:
  - id: "@blockrun/clawrouter"
    config:
      routing:
        tiers:
          COMPLEX:
            primary: "openai/gpt-4o"
          SIMPLE:
            primary: "openai/gpt-4o-mini"
        scoring:
          reasoningKeywords: ["proof", "theorem", "formal verification"]
```

### Pin a Model

Skip routing. Use one model for everything:

```bash
openclaw config set model openai/gpt-4o
```

You still get x402 payments and usage logging.

## Architecture

```
src/
├── index.ts              # Plugin entry — register() + activate()
├── provider.ts           # Registers "blockrun" provider in OpenClaw
├── proxy.ts              # Local HTTP proxy — routing + x402 payment
├── models.ts             # 30+ model definitions with pricing
├── auth.ts               # Wallet key resolution (env, config, prompt)
├── logger.ts             # JSON lines usage logger
├── types.ts              # OpenClaw plugin type definitions
└── router/
    ├── index.ts           # route() entry point
    ├── rules.ts           # Weighted classifier (14 dimensions, sigmoid confidence)
    ├── llm-classifier.ts  # LLM fallback (gemini-flash, cached)
    ├── selector.ts        # Tier → model selection + cost calculation
    ├── config.ts          # Default routing configuration
    └── types.ts           # RoutingDecision, Tier, ScoringResult
```

The plugin runs a local HTTP proxy between OpenClaw and BlockRun's API. OpenClaw sees a standard OpenAI-compatible endpoint at `localhost`. Routing is **client-side** — open source and inspectable.

```
OpenClaw Agent
    │
    ▼
ClawRouter (localhost proxy)
    │  ① Classify query (rules → LLM fallback)
    │  ② Pick cheapest capable model
    │  ③ Sign x402 USDC payment
    │
    ▼
BlockRun API → Provider (OpenAI, Anthropic, Google, DeepSeek, xAI)
```

## Programmatic Usage

Use ClawRouter as a library without OpenClaw:

```typescript
import { startProxy } from "@blockrun/clawrouter";

const proxy = await startProxy({
  walletKey: process.env.BLOCKRUN_WALLET_KEY!,
  onReady: (port) => console.log(`Proxy on port ${port}`),
  onRouted: (d) => {
    const saved = (d.savings * 100).toFixed(0);
    console.log(`${d.model} (${d.tier}) saved ${saved}%`);
  },
});

// Use with any OpenAI-compatible client
const res = await fetch(`${proxy.baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "blockrun/auto",
    messages: [{ role: "user", content: "What is 2+2?" }],
  }),
});

await proxy.close();
```

Or use the router directly:

```typescript
import { route, DEFAULT_ROUTING_CONFIG } from "@blockrun/clawrouter";

const decision = await route("Prove sqrt(2) is irrational", undefined, 4096, {
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing,
  payFetch,
  apiBase: "https://blockrun.ai/api",
});

console.log(decision);
// {
//   model: "openai/o3",
//   tier: "REASONING",
//   confidence: 0.973,
//   method: "rules",
//   savings: 0.893,
//   costEstimate: 0.032776,
//   baselineCost: 0.307500,
// }
```

## Development

```bash
git clone https://github.com/BlockRunAI/ClawRouter.git
cd ClawRouter
npm install
npm run build        # Build with tsup
npm run dev          # Watch mode
npm run typecheck    # Type check

# Run tests
npx tsup test/e2e.ts --format esm --outDir test/dist --no-dts
node test/dist/e2e.js

# Run with live proxy (requires funded wallet)
BLOCKRUN_WALLET_KEY=0x... node test/dist/e2e.js
```

## Roadmap

- [x] Provider plugin — one wallet, 30+ models, x402 payment proxy
- [x] Smart routing — hybrid rules + LLM classifier, 4-tier model selection
- [x] Usage logging — JSON lines to disk, per-request cost tracking
- [x] Weighted scoring engine — 14 dimensions, sigmoid confidence, configurable tier boundaries
- [ ] KNN fallback — embedding-based classifier to replace LLM fallback (<5ms vs ~200ms)
- [ ] Cascade routing — try cheaper model first, escalate on low quality (AutoMix-inspired)
- [ ] Graceful fallback — auto-switch on rate limit or provider error
- [ ] Spend controls — daily/monthly budgets, server-side enforcement
- [ ] Cost dashboard — analytics at blockrun.ai

## Why Not OpenRouter / LiteLLM?

They're built for developers — create an account, get an API key, prepay a balance, manage it through a dashboard.

ClawRouter is built for **agents**. The difference:

| | OpenRouter / LiteLLM | ClawRouter |
|---|---|---|
| **Setup** | Human creates account, gets API key | Agent generates wallet, pays per request |
| **Payment** | Prepaid balance (custodial) | Per-request micropayment (non-custodial) |
| **Auth** | API key (shared secret) | Wallet signature (cryptographic proof) |
| **Custody** | Provider holds your money | USDC stays in YOUR wallet until spent |
| **Routing** | Proprietary / closed | Open source, client-side, inspectable |

As agents become autonomous, they need financial infrastructure designed for machines. An agent shouldn't need a human to sign up for a service and paste an API key. It should generate a wallet, receive funds, and pay per request — programmatically.

## Test Results

Real output from `node test/dist/e2e.js` — weighted scoring with sigmoid confidence:

```
═══ Rule-Based Classifier ═══

Simple queries:
  ✓ "What is the capital of France?" → SIMPLE (score=-0.200)
  ✓ "Hello" → SIMPLE (score=-0.200)
  ✓ "Define photosynthesis" → SIMPLE (score=-0.125)
  ✓ "Translate hello to Spanish" → SIMPLE (score=-0.200)
  ✓ "Yes or no: is the sky blue?" → SIMPLE (score=-0.200)

Complex queries (correctly deferred to classifier):
  ✓ Kanban board → AMBIGUOUS (score=0.090, conf=0.673)
  ✓ Distributed trading → AMBIGUOUS (score=0.127, conf=0.569)

Reasoning queries:
  ✓ "Prove sqrt(2) irrational" → REASONING (score=0.180, conf=0.973)
  ✓ "Derive time complexity" → REASONING (score=0.186, conf=0.973)
  ✓ "Chain of thought proof" → REASONING (score=0.180, conf=0.973)

═══ Full Router ═══

  ✓ Simple factual → google/gemini-2.5-flash (SIMPLE, rules) saved=99.2%
  ✓ Greeting → google/gemini-2.5-flash (SIMPLE, rules) saved=99.2%
  ✓ Math proof → openai/o3 (REASONING, rules) saved=89.3%

═══════════════════════════════════
  19 passed, 0 failed
═══════════════════════════════════
```

**Bottom line:** A simple "What is 2+2?" costs **$0.002** instead of **$0.308** on Opus — that's **99% savings** on every simple query.

## License

MIT
