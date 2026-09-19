# apple-pi 🥧

> A personal engineering harness for [Pi](https://github.com/badlogic/pi-mono).
> Bounded programmatic composition, dual-hemisphere pairing, cache-sanctified context, bifurcated memory, and zero-bullshit workflow continuity.

---

## The Personal Memo: Why This Exists

I spend thousands of hours a year inside coding agent harnesses. If you live on the frontier of AI-assisted software development, you quickly realize a frustrating truth: **95% of contemporary "AI agent" tooling is built backwards.**

The ecosystem is flooded with two extremes:
1. **The Venture-Backed Framework Trap**: Bloated Python frameworks with 14 layers of leaky abstractions, unreadable trace graphs, local vector databases indexing 30 files, and multi-agent chat loops where models circle-jerk in unstructured English until the context window explodes.
2. **The Naive Chat Loop**: A single prompt loop wired directly to bash and file-editing tools, dumping 50,000 tokens of raw terminal output, compiler errors, and git diffs straight into the LLM context every turn—destroying attention, nuking prompt cache prefixes, and driving latency and costs through the roof.

The dirty secret of coding agents is that adding more AI does not make software better. Adding **discipline, mechanical leverage, and respect for the model/hardware boundary** does.

My fitness function is uncompromising: **minimum code with maximum function, clarity, and leverage.** Every pattern in this repository earned its place through blood, sweat, and token burns across thousands of real engineering sessions. If a pattern didn't make me dramatically faster, or if an abstraction became a tax on understanding, it was mercilessly excised.

[Pi](https://github.com/badlogic/pi-mono) (by Mario Zechner) gave me the ideal host: a fast, lean, hackable TypeScript core with zero ambient fluff. Above Pi, **apple-pi** is my personal operating environment. I borrow freely from [Superpowers](https://github.com/obra/superpowers), [10x](https://github.com/z3z1ma/10x), [Prime Intellect](https://github.com/PrimeIntellect-ai/prime-agent), [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), [craftzdog's tmux workflow](https://github.com/craftzdog/tmux-claude-session-manager), and [NVIDIA AVO](https://developer.nvidia.com/blog/nvidia-avo-reaches-100-on-arc-agi-3-demonstrating-a-frontier-level-general-purpose-architecture-for-long-horizon-autonomous-agents/), but I reduce them into a single, cohesive, hardened package that treats agentic coding as a serious engineering discipline.

---

## The Core Paradigms: How Apple Pi Actually Works

Apple Pi is architected around six core pillars that fundamentally alter how an agent thinks, composes, remembers, and executes.

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                   ROOT PI SESSION                       │
                     │  ┌───────────────────┐        ┌──────────────────────┐  │
                     │  │    MAIN AGENT     │◄──────►│   PAIR PROGRAMMER    │  │
                     │  │  (Driver / Keys)  │        │ (Shared Navigator)   │  │
                     │  └─────────┬─────────┘        └──────────┬───────────┘  │
                     └────────────┼─────────────────────────────┼──────────────┘
                                  │                             │ (escalates)
                                  ▼                             ▼
                    ┌───────────────────────────┐  ┌───────────────────────────┐
                    │          PI EXEC          │  │        CONSULTANT         │
                    │  Disposable Node Worker   │  │ (Senior Architect Review) │
                    │  • Loops & Pipelines      │  └───────────────────────────┘
                    │  • Fan-out subagents      │
                    │  • State snapshots (<id>) │
                    │  • Schema-filtered return │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌───────────────────────────────┐         ┌─────────────────────────────────┐
│       THE LEDGER (.ledger/)   │         │       THE WIKI (.wiki/)         │
│ Operational task context      │         │ Durable cross-task knowledge    │
│ • task.md + retrospective.md  │         │ • Obsidian [[slug]] pages       │
│ • Auto-archives to history/   │         │ • Derived on-demand graph       │
└───────────────────────────────┘         └─────────────────────────────────┘
```

### 1. Programmatic Composition via `pi_exec`

The prevailing agent pattern—chat-driven tool calling—is an architectural dead end for complex workflows. When an agent searches 40 files or tests 10 hypotheses, dragging each intermediate 10,000-token result through the primary LLM conversation pollutes context, triggers "lost in the middle" reasoning degradation, and incinerates money.

[`pi_exec`](docs/exec.md) changes the game. It gives the agent a **bounded JavaScript async runtime** executed inside a disposable worker. Instead of babbling through tool calls, the model writes real code:

- **True Control Flow**: Normal loops, conditionals, `parallel(items, mapper, concurrency)`, and `pipeline(...)`.
- **In-Memory Filtering & Reduction**: Parse, grep, transform, and aggregate data inside the worker. Return *only the needle or the distilled summary* back to the conversation via a strict JSON Schema (`outputSchema`).
- **Immutable State Snapshots (`state: <id>`)**: Inspired by `prime-agent`, programs can retain expensive serialized state across calls using explicit, immutable state IDs, without needing a persistent, fragile Python kernel or daemon.
- **Code-as-Tools Harness (`.pi/programs/`)**: The model can author reusable async programs in `.pi/programs/<name>.js` with typed `@param` JSDoc annotations. Saved programs manifest directly as native, typed tools (`program_<name>`) on session starts and compactions (preserving KV prefix cache stability mid-turn), or run dynamically via `pi_exec_program`. The agent builds its own first-class tool abstractions.

```javascript
// Example: Bounded fan-out inspection without context pollution
const files = (await pi.ls({ path: "components" }))
  .split("\n")
  .filter((f) => f.endsWith(".ts"));

return parallel(
  files,
  async (file) => {
    const result = await agent.run({
      task: "Inspect this file for concurrency leaks or unhandled rejections.",
      name: file,
      context: { path: `components/${file}` },
      outputSchema: std.schema({
        risk: ["low", "medium", "high"],
        evidence: "string",
      }),
    });
    return { file, ...(result.value ?? {}) };
  },
  4,
); // Max 4 concurrent workers
```

### 2. Dual-Hemisphere Pairing & The Escalation Ladder

Most "pair programming" bots are either annoying linters that squawk on every keystroke or separate chat windows that know nothing about your session.

The [pair programmer](docs/pair-programmer.md) in apple-pi implements true dual-hemisphere engineering:
- **Main Agent (The Driver)**: Holds the keyboard, edits files, executes tests, communicates with the operator, and owns the decisions.
- **Pair Programmer (The Navigator)**: Runs silently in the background on an economical inference profile (`pair`). It watches the driver's shared screen, diffs, tool calls, and failures.
- **Capability Receipts (`expand_receipt`)**: Huge file reads, multiline diffs, and images are folded behind opaque receipt tokens. The pair's context is never flooded with noise, but it can selectively expand receipts if concrete evidence is needed.
- **Transactional Frontier Reviews**: The pair doesn't interrupt on every micro-turn. It spools trajectory deltas and evaluates them at meaningful semantic frontiers (mutations, failures, verification steps). Interventions (`nit`, `concern`, `blocker`) are held until confirmed by newer trajectory evidence.
- **The Senior Architect Escalation (`ask_consultant`)**: When the pair spots a consequential architectural concern, it doesn't guess. It calls `ask_consultant`, dispatching a senior software architect teammate on the `deep` profile (e.g. Claude Opus 5 xhigh) with a full evidence packet. The consultant returns a formal second opinion (`confirm`, `refute`, `refine`, `uncertain`).
- **Material Finding Acknowledgment**: When a `concern` or `blocker` is delivered, the driver is held accountable: it must explicitly call `acknowledge_pair_findings` with `address`, `decline`, or `defer`.

### 3. Context Sanctity & Prefix-Cache Preservation

Prompt caching (KV caching) is the single most critical performance and economic factor when working with frontier models. If your harness rewrites message history, reorders messages, or injects synthetic assistant responses mid-turn, it invalidates the provider cache prefix. You pay full cache-write latency (10–30 seconds) and 10x token costs on every single turn.

Apple Pi enforces **strict append-only context**:
- **Single Compaction Hook Owner**: On xAI models, [`xai-context-compaction`](docs/context.md) invokes server-side `/responses/compact` and replays opaque encrypted tokens. On other providers, native Pi summarization handles the boundary.
- **Fail-Closed Compaction Safety (`auto-compact`)**: Pi 0.84.4 has an edge-case gap where an over-budget tool result batch fails to trigger native compaction. `auto-compact.ts` patches this via a hidden cut-point marker, preventing runaway context overflows without rewriting provider serialization.
- **The Sourced Notebook (`update_notebook`)**: The driver and pair continuously curate high-leverage working conclusions backed by exact session citations (`revisit_note`). Only active conclusions are injected—as a single message packet *immediately after compaction*. The harness never rewrites turns mid-flight.

### 4. Bifurcated Memory: The Ledger vs. The Wiki

Monolithic "memory" files or vector databases always rot. They mix temporary task notes with permanent architecture rules, growing until the model gets confused and starts hallucinating stale constraints.

Apple Pi splits memory cleanly by lifecycle:

| Storage | Lifecycle | Purpose | Mechanics |
| --- | --- | --- | --- |
| **[The Ledger](docs/ledger.md)** (`.ledger/`) | Ephemeral / Task-Scoped | Operational scratchpad for one undertaking: plans, tickets, specs, decisions, prototypes, evidence. | Created via `ledger_add`. Contains `task.md` and `retrospective.md`. Closed via `ledger_close`, which atomically archives the whole bundle to `.ledger/history/`. Git-native, zero database. |
| **[The Wiki](docs/wiki.md)** (`.wiki/`) | Durable / Cross-Task | Karpathy-style knowledge base for reusable domain knowledge, architecture patterns, and operational wisdom. | Plain Markdown pages with Obsidian `[[slug]]` links. No vector DB, no daemon. Graph is derived on-demand via `wiki_lint` and `wiki_references`. |
| **[Distill](docs/distill.md)** (`/distill`) | Retrospective Synthesis | Proposal-first harvesting of durable lessons learned during a session into their rightful homes. | Analyzes the session and proposes updates to `AGENTS.md`, `.wiki/`, task retrospectives, skills, or `.pi/programs/`. Requires human approval before writing. |
| **[One-Shot Scheduling](docs/scheduling.md)** (`schedule`) | Execution Continuity | Defer one self-authored prompt or bash command within the root session. | Prompts wake when due; commands start silently and wake on completion. Shared `task` IDs, cancellation, and lifecycle cleanup; no cron daemon or persistent scheduler. |
| **[Reactive Monitoring](docs/tasks.md)** (`monitor`) | Execution Continuity | Run a shell event adapter whose meaningful stdout lines steer the agent while it continues working. | One event per completed stdout line, optional caller-owned delivery limit, shared task inspection/cancellation, and completion wake-up. |
| **[Optional Extensions](docs/optional-extensions.md)** | Retained Task Systems | Packaged and tested backlog/to-do implementations for workflows requiring persistent task managers. | Opt-in via project/user configuration; never loaded into the default minimal harness surface. |

### 5. Specialist Team & The Invisible Child Clarification

Instead of a generic agent doing everything poorly, the [subagent system](docs/subagents.md) provides focused specialist lanes mapped to semantic [model profiles](docs/model-profiles.md):

- `explorer` (`quick`): Rapid local codebase reconnaissance (`read`, `grep`, `find`, `ls`).
- `planner` (`deep`): Implementation strategy and cross-module architectural design.
- `researcher` (`quick`): External documentation and primary source investigation.
- `consultant` (`deep`): Senior architect for root-cause analysis, YAGNI enforcement, and second opinions.
- `builder` (`coding`): Bounded, specified write slices (paired with a sidecar by default).
- `designer` (`visual-engineering`): User-facing layout, interaction design, and visual polish.

**The Child `clarify` Superpower**: Subagents often get stuck on ambiguous instructions. In traditional systems, they either hallucinate or spam the user. In Apple Pi, every public child subagent receives a child-only `clarify` tool. It takes an in-memory, read-only snapshot of the parent's conversation and answers the child's question *without interrupting the parent or cluttering the parent's context*.

**The Private Sidecar (`/btw`)**: When *you* want to ask a question without derailing the agent or polluting its history, [`/btw`](docs/btw.md) opens an ephemeral, read-only Markdown overlay. Read the answer, copy it to the clipboard (`Ctrl+X`), or inject it directly into the main thread (`Alt+I`).

### 6. Hardware-Level Ergonomics & Terminal Bliss

A great harness must feel like an extension of your nervous system. Apple Pi includes deep OS- and terminal-level integrations:

- **[Tmux Sessions (`tmux-sessions`)](docs/tmux-sessions.md)**: Manage dozens of concurrent Pi sessions across multiple repositories. Each session publishes its state (`busy`, `idle`, `waiting`) atomically to disk. Press `prefix + y` to open/resume a session popup for the current directory; press `prefix + u` to open a fuzzy fzf session switcher with live pane previews. Bell forwarding rings the origin window when an agent finishes.
- **[Native macOS Notifications (`notify`)](docs/notify.md)**: Completing a long-running turn or blocking on an interactive question fires a native macOS notification via `terminal-notifier` or `Pi Notifier.app`. Clicking the notification immediately focuses Ghostty and selects the exact tmux pane. Includes a smart suppression engine: if your eyes are already on the pane, it stays quiet.
- **[Vroom / Fast Mode (`vroom`)](docs/vroom.md)**: Run `/fast` to toggle priority service tiers on OpenAI Codex and xAI Grok mid-run across root, subagents, and `pi_exec`.
- **[Input Editor (`input-editor`)](docs/input-editor.md)**: Keeps the custom left-rail editor and model metadata while removing the bottom rail and footer row, displaying a muted `pair · mcp:N · hit:X% · ctx:X%` indicator right-justified on the bottom of the editor.
- **[Search Root Guard (`home-search-guard`)](docs/home-search-guard.md)**: Fail-closed guardrails that stop the agent from accidentally running recursive greps across `/`, `~`, or workspace roots.
- **[Structured Questionnaires (`ask_user_question`)](docs/ask-user-question.md)**: Allows the model to group up to four related decisions into a clean tabbed TUI questionnaire with described options, multi-select, and custom text inputs.
- **[MCP Gateway (`mcp`)](docs/mcp.md)**: Pinned `pi-mcp-adapter` gateway exposed as a token-efficient `mcp` tool (`/mcp`), bridging external tools and resources directly into interactive sessions and `pi_exec` composition.
- **[Managed Tasks, Scheduling & Reactive Execution (`tasks`)](docs/tasks.md)**: Start quiet background commands, schedule one-shot prompts and commands, or run `monitor` event adapters whose completed stdout lines steer the agent immediately. All use shared `task` inspection/cancellation and completion wake-up. Root-only `schedule`, `monitor`, and `task` stay outside `pi_exec`.
- **[xAI Hosted Tools](docs/xai-hosted-tools.md)**: Transparent provider-request transformation for Grok Responses API, injecting `{ type: "web_search" }` and `{ type: "x_search" }` without duplicating tool definitions.

---

## Packaged Workflow Skills

Apple Pi ships with a suite of battle-tested engineering skills in [`skills/`](skills). These are not rigid, inescapable agent pipelines; they are on-demand procedures loaded when the situation demands them:

### High-Leverage Architecture & Design
- [`/skill:interrogate-to-design`](skills/interrogate-to-design) & [`/interrogate`](prompts/interrogate.md): Deep Socratic interview mapping decisions as a dependency tree and resolving the entire frontier before code is written.
- [`/skill:to-spec`](skills/to-spec): Synthesizes settled multi-session exploration into a rigorous, testable specification.
- [`/skill:to-tickets`](skills/to-tickets): Decomposes specifications into tracer-bullet tickets with explicit dependency blocking edges.
- [`/skill:wayfinder`](skills/wayfinder): Charts multi-session maps of decision tickets for complex greenfield projects.
- [`/skill:improve-codebase-architecture`](skills/improve-codebase-architecture): Surveys evolving code to identify deepening opportunities and simplify abstractions.

### Execution & Verification
- [`/skill:implement`](skills/implement): Builds settled tickets through strict TDD, feedback cycles, and reviewer verification.
- [`/skill:tdd`](skills/tdd): Red → Green → Refactor vertical slices with confirmed test seams.
- [`/skill:diagnosing-bugs`](skills/diagnosing-bugs): Hypothesis-driven debugging that tightens feedback loops before touching code.
- [`/skill:prototype`](skills/prototype): Builds throwaway experiments designed exclusively to answer one empirical design question.
- [`/skill:resolving-merge-conflicts`](skills/resolving-merge-conflicts): Resolves complex git merges by analyzing the intent of both branches.

### Orthogonal Code Review & Ralph
- [`/skill:code-review`](skills/code-review) ([contract](docs/code-review.md)): Reviews pull requests or working branches across two completely independent axes: **Standards** (repository conventions) vs. **Intent / Spec** (did we build what was asked?). Supports multi-lens `pi_exec` parallel fan-out and candidate verification.
- [`/skill:ralph`](skills/ralph): Bounded fresh-context execution loops over prepared ledger tasks or self-contained goals.

### Engineering Disciplines
- [`/skill:domain-modeling`](skills/domain-modeling): Sharpens ubiquitous language, bounded contexts, invariants, and durable domain models.
- [`/skill:codebase-design`](skills/codebase-design): Designs deep modules, deliberate seams, and high-leverage interfaces with minimal surface area.
- [`/skill:research`](skills/research): Investigates externally verifiable engineering questions through primary sources and official documentation.

### Harness & Knowledge Authoring
- `pi_exec` is a native harness capability whose core instructions and live schema teach bounded JavaScript composition and reusable `.pi/programs`; it does not require a separate skill.
- [`/skill:skill-authoring`](skills/skill-authoring): Author concise, testable Agent Skills with progressive disclosure.
- [`/skill:llm-wiki`](skills/llm-wiki): Initialize, ingest, query, and maintain the project-local `.wiki/` knowledge graph.

---

## What Was Deliberately Rejected

Architecture is defined by what you choose *not* to build. Consult [`docs/boundaries.md`](docs/boundaries.md) for the full record of rejected ideas:

- ❌ **No Vector Databases or Local Embedding Stores**: Lexical search, ripgrep, and derived Markdown graph traversal consistently outperform vector similarity on codebases while eliminating database corruptions and indexing lag.
- ❌ **No Persistent Python Kernels or Background Daemons**: Stateful IPython runtimes leak memory, break determinism, and create ghost state. `pi_exec` uses disposable Node workers with immutable state snapshots.
- ❌ **No Mid-Turn Context Rewriting**: Editing or shifting messages mid-thread destroys provider KV prompt caching. Context remains strictly append-only.
- ❌ **No Git Worktree Circus for Subagents**: Subagents operate directly in the workspace or use ordinary git commands when needed. No fragile automated worktree management layers.
- ❌ **No Monolithic Memory Files**: A single `MEMORY.md` file inevitably becomes a toxic dump of conflicting notes. Apple Pi separates operational task bundles (`.ledger/`) from durable knowledge (`.wiki/`).

---

## Quickstart & Setup

### Requirements
- **Host**: macOS recommended (for native notifications and Ghostty/tmux focus scripts).
- **Node.js**: `>= 22.19.0`
- **Pi**: `>= 0.85.1` (`npm install -g @earendil-works/pi-coding-agent`)
- **Optional Tools**: `tmux` (≥ 3.2), `terminal-notifier`, `fzf`, `jq`, `ghostty`, [`rtk`](docs/rtk.md) (≥ 0.23.0 for token-efficient bash execution).

### Installation

Update Pi, install dependencies, and register the package:

```bash
pi update
npm install
pi install /absolute/path/to/apple-pi
```

*(Add `-l` to `pi install` if you prefer project-local activation rather than global).*

### Model Profiles Configuration

Apple Pi decouples semantic roles from specific provider models via `~/.pi/agent/model-profiles.json`. Configure your preferred providers and thinking levels:

```json
{
  "profiles": {
    "quick": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "medium"
    },
    "balanced": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "high"
    },
    "pair": {
      "model": "xai/grok-4.6",
      "thinking": "medium"
    },
    "deep": {
      "model": "anthropic/claude-opus-5",
      "thinking": "xhigh"
    },
    "coding": {
      "model": "xai/grok-4.6",
      "thinking": "high"
    },
    "visual-engineering": {
      "model": "github-copilot/gemini-3.7-flash",
      "thinking": "medium"
    },
    "background": {
      "model": "openai-codex/gpt-5.6-luna",
      "thinking": "low"
    }
  }
}
```

### Essential Commands & Keybindings

| Command / Key | Action |
| --- | --- |
| `/pair [on\|off\|status]` | Manage the background pair programming partner and notebook |
| `/btw [question]` | Open the private, read-only side conversation |
| `Alt+I` *(in BTW)* | Inject the latest BTW answer into the main conversation |
| `/fast` | Toggle priority service tier (`⚡`) for OpenAI Codex and xAI |
| `/distill [focus]` | Harvest durable lessons into `.wiki/`, `.ledger/`, or `AGENTS.md` |
| `ledger_add` / `ledger_close` | Create or archive an operational task bundle in `.ledger/` |
| `prefix + y` *(in tmux)* | Launch or attach to a Pi session for the current directory in a popup |
| `prefix + u` *(in tmux)* | Open the interactive fuzzy session picker |
| `Ctrl+S` / `Alt+S` | Stash the current editor prompt into the prompt stash |
| `Ctrl+Shift+S` / `Alt+Shift+S` | Pop the top prompt from stash back into the editor |
| `Ctrl+Alt+S` / `/stash` | Open the interactive prompt stash picker |
| `Ctrl+E` / `Alt+E` / `/edit-prompt` | Open current prompt in external editor (`$EDITOR` / `vim`) |
| `/notify-setup` | Install the native `Pi Notifier.app` for macOS click-to-focus |

---

## Development & Verification

All validation commands are enforced via Biome, TypeScript strict mode, Vitest, and custom loader suites:

```bash
npm run check        # Run format:check, lint, and typecheck
npm test             # Run unit tests, pair programmer harness, and loader validation
npm run pack:check   # Verify npm tarball inclusion boundaries
```

For formatting files you touched:
```bash
npx biome format --write README.md
```

See [`docs/development.md`](docs/development.md) for module conventions and architectural rules.

---

## Provenance & License

- Third-party notices and licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- Original code and novel architectures in `apple-pi` are licensed under [MIT](LICENSE).
