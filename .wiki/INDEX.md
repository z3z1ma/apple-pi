# Index

## Domain language

- [[domain-contexts]]: the two contexts, the Apple Pi harness and Agent World, and how they relate.
- [[agent-world-language]]: Agent World vocabulary: characters, coordinators, workers, headquarters, wings, buildings, hubs, work items; theme-neutral terms with fantasy names in brackets.
- [[agent-world-development]]: hazards found while building Agent World: headless UI tests, world and interface code, place data and art, performance.
- [[domain-language]]: working vocabulary for the active harness; all retained optional modules are outside the domain. Persons, interns, the pair programmer, and the BTW conversation are distinct participant kinds. Task means an undertaking; job means runtime-managed work. Runtime tools, code, and product docs still use the existing names; aligning them is separate work. Context boundaries and unqualified “agent” and “background” conventions remain open.

## Design

- [[tui-interaction-model]]: the interaction model for Apple Pi overlays and the glanceable work panel (settled; `docs/tasks.md` owns the contract).
- [[epistemic-grounding]]: why the harness ties beliefs to what actually ran; adopted, tried, untried, and rejected ideas, including what branch search showed.

## Method

- [[session-log-analysis]]: measuring agent behavior from Pi session JSONL, and the traps.

- [[terminal-rendering-visual-checks]]: synthetic ANSI renderer checks with Bun, Rich SVG conversion, and the HTML-embedded SVG screenshot fallback.

## Pi internals

- [[pi-request-internals]]: how Pi builds a provider request, and how to continue a conversation with an identical one.
