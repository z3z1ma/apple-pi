// PROTOTYPE: the world state the headquarters shows: seeded sessions, or live ones from live.json, and the
// derived places (wings per repository, remembered once seen; common room; dormant; independent).
const MEMORY = "agent-world-hq-prototype-wings";

export const SEED = [
	{ id: "coord", name: "Orla", coordinator: true, awake: true, status: "idle", repository: null },
	{ id: "a1", name: "Session state", reportsTo: "coord", awake: true, status: "busy", tool: "bash", toolArg: "npx vitest run components/session-state", repository: "apple-pi", task: "202610172354-session-state-model" },
	{ id: "a2", name: "Notch polish", reportsTo: "coord", awake: true, status: "waiting", repository: "apple-pi", task: "202610160838-notch-agent-room" },
	{ id: "a3", name: "Docs sweep", reportsTo: "coord", awake: true, status: "idle", needsYou: true, repository: "apple-pi" },
	{ id: "a4", name: "Invoice retries", reportsTo: "coord", awake: true, status: "busy", tool: "edit", toolArg: "src/retry.ts", repository: "billing-service" },
	{ id: "a5", name: "Ingest backfill", reportsTo: "coord", awake: true, status: "idle", repository: "data-pipeline" },
	{ id: "a6", name: "Phaser spike", reportsTo: "coord", awake: true, status: "busy", tool: "read", toolArg: "notes/phaser.md", repository: null },
	{ id: "a7", name: "Old migration", reportsTo: "coord", awake: false, status: "idle", repository: "billing-service" },
	{ id: "i1", name: "Blog draft", awake: true, status: "idle", repository: "blog" },
];

export const SEED_REMEMBERED = ["apple-pi", "legacy-auth", "billing-service"];

/** Slack channels, as townsfolk in the square. Seed data: the prototype has no Slack connection. */
export const SEED_CHANNELS = [
	{ id: "#incidents", name: "#incidents", channel: true, unread: 3, lastAuthor: "pagerbot", lastText: "Ingest lag over 15 minutes on pipeline-prod." },
	{ id: "#eng-data", name: "#eng-data", channel: true, unread: 1, lastAuthor: "Priya", lastText: "Has anyone looked at the backfill job since the schema change?" },
	{ id: "#random", name: "#random", channel: true, unread: 0, lastAuthor: "Sam", lastText: "Cake in the kitchen, first come first served." },
];

export function loadRemembered(fallback) {
	try {
		return JSON.parse(localStorage.getItem(MEMORY)) ?? fallback;
	} catch {
		return fallback;
	}
}

export function saveRemembered(list) {
	localStorage.setItem(MEMORY, JSON.stringify(list));
}

/** Places and who is in them. A coordinator's awake agents stand in their repository's wing. */
export function derive(sessions, remembered, channels = SEED_CHANNELS) {
	const coordinator = sessions.find((s) => s.coordinator && s.awake) ?? null;
	const mine = sessions.filter((s) => coordinator && s.reportsTo === coordinator.id);
	const awake = mine.filter((s) => s.awake);
	const wingNames = [...remembered];
	for (const s of awake) if (s.repository && !wingNames.includes(s.repository)) wingNames.push(s.repository);
	return {
		coordinator,
		wings: wingNames.map((repo) => ({ repo, agents: awake.filter((s) => s.repository === repo) })),
		common: awake.filter((s) => !s.repository),
		dormant: mine.filter((s) => !s.awake),
		independent: sessions.filter((s) => s.awake && !s.coordinator && !(coordinator && s.reportsTo === coordinator.id)),
		remembered: wingNames,
		channels,
	};
}

/** What a character says when you talk to it: its real state, in the voice of the setting. */
export function lineFor(s) {
	if (s.channel) return `${s.lastAuthor}: “${s.lastText}”`;
	if (s.coordinator) return "Welcome back to the hall. The wings are through the east arch; I keep the board of everyone's work.";
	if (!s.awake) return "(sound asleep; reopen the session to wake them)";
	if (s.status === "waiting") return "I have a question for you before I can go on.";
	if (s.needsYou) return "I finished. Come see what I made when you have a moment.";
	if (s.status === "busy") return s.tool ? `Busy with ${s.tool}${s.toolArg ? `: ${s.toolArg}` : ""}.` : "Thinking it through.";
	return "Nothing on my bench right now.";
}
