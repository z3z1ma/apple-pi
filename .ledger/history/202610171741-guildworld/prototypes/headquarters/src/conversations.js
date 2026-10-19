// PROTOTYPE: seed conversations for the talk panel (the prototype has no runtime connection). Entries are in
// transcript order: you (the operator), the agent's Markdown replies, and tool calls folded to one line.
export const CONVERSATIONS = {
	coord: [
		{ role: "you", text: "Morning. What needs me today?" },
		{ role: "agent", text: "Good morning. Three things:\n\n1. **Notch polish** is waiting on a design choice from you.\n2. **Docs sweep** finished; it needs a quick read before it merges.\n3. **#incidents** reports ingest lag on `pipeline-prod`. I can start someone on it.\n\nEverything else is moving." },
		{ role: "tool", name: "ledger", arg: "read .ledger/INDEX.md" },
		{ role: "you", text: "Start someone on the ingest lag." },
		{ role: "agent", text: "Starting a worker in `data-pipeline` with a brief from the incident thread. I will tell you when it reports." },
	],
	a1: [
		{ role: "you", text: "Run the session-state suite and fix whatever breaks." },
		{ role: "tool", name: "bash", arg: "npx vitest run components/session-state" },
		{ role: "agent", text: "Two failures in `attention.test.ts`, both timing: the option waits use the 1 s default and the poll is 1 s.\n\n```ts\nawait vi.waitFor(() => expect(option(\"@pi_agents\")).toContain(\"? 1\"), { timeout: 5000 });\n```\n\nRaising the timeouts now, then rerunning." },
		{ role: "tool", name: "edit", arg: "components/session-state/tests/attention.test.ts" },
		{ role: "tool", name: "bash", arg: "npx vitest run components/session-state" },
	],
	a2: [
		{ role: "you", text: "Make the notch dots easier to read at a glance." },
		{ role: "tool", name: "read", arg: "components/tmux-sessions/notch/web/index.html" },
		{ role: "agent", text: "I have two directions that both work. They change how the pill looks, so I would rather you choose." },
	],
	a3: [
		{ role: "you", text: "Sweep the docs for anything that still mentions the mailbox files." },
		{ role: "tool", name: "bash", arg: "grep -rn mailbox docs" },
		{ role: "tool", name: "edit", arg: "docs/scheduling.md" },
		{ role: "tool", name: "edit", arg: "docs/boundaries.md" },
		{ role: "agent", text: "Done. Two pages still pointed at the old mailbox:\n\n- `docs/scheduling.md` now sends ticks as mail through `pi-send.mjs`.\n- `docs/boundaries.md` describes mail in the session-state database.\n\nNothing else mentions the old files." },
	],
};

/** A reply still being written, streamed in while you watch (busy agents). */
export const STREAMING = {
	a1: "Both timing failures pass with 5 s waits. Rerunning the whole suite to be sure nothing else",
	coord: "",
};

/** Open questionnaires, as `ask_user_question` would pose them. */
export const QUESTIONNAIRES = {
	a2: [
		{
			question: "Which direction should the notch dots take?",
			header: "Dots",
			options: [
				{ label: "Colour and shape", description: "Each state gets its own colour and its own shape, so it reads without colour too." },
				{ label: "Grouped with counts", description: "Dots are grouped by state with a small number per group; quieter, less detail." },
			],
		},
		{
			question: "Should finished agents pulse until you look?",
			header: "Pulse",
			options: [
				{ label: "Yes, gently", description: "A slow pulse that stops once you open the panel." },
				{ label: "No", description: "Finished agents stay still; only questions pulse." },
			],
		},
	],
};
