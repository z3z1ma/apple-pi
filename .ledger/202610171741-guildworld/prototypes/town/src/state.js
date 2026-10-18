// PROTOTYPE: world state for the Agent World town. Mirrors the real feed (agents.py list) plus the tmux session list.
// A session: { id, name, status: "busy"|"idle"|"waiting", tmuxSession, reportsTo, cwd, task, tool, detail }.

export function seedState() {
	return {
		coordinators: ["orchard-work"],
		tmuxSessions: ["CodingHarness", "Work", "0"],
		sessions: [
			{ id: "orchard-work", name: "Weekly sweep", status: "idle", tmuxSession: "CodingHarness", reportsTo: "", cwd: "~/code_projects/work", task: "Coordinator home", tool: "read", detail: "ledger/INDEX.md" },
			{ id: "data-16969", name: "DATA-16969", status: "busy", tmuxSession: "Work", reportsTo: "orchard-work", cwd: "~/code_projects/work/worktrees/DATA-16969", task: "Materialized wide reporting tables", tool: "bash", detail: "dbt build -s wide_reporting" },
			{ id: "agent-world", name: "Agent World map", status: "busy", tmuxSession: "CodingHarness", reportsTo: "", cwd: "~/code_projects/personal/apple-pi", task: "Agent World: themeable world over real Pi sessions", tool: "edit", detail: "prototypes/town/src/scene.js" },
			{ id: "harness-idle", name: "apple-pi", status: "idle", tmuxSession: "CodingHarness", reportsTo: "", cwd: "~/code_projects/personal/apple-pi", task: "", tool: "read", detail: "docs/tasks.md" },
		],
	};
}

let counter = 0;
const STATUSES = ["busy", "idle", "waiting"];
const TOOLS = [["edit", "src/index.ts"], ["read", "README.md"], ["bash", "npm test"], ["grep", "retryPolicy"], ["write", "notes.md"]];

export function newSession(tmuxSession, reportsTo) {
	counter += 1;
	const [tool, detail] = TOOLS[counter % TOOLS.length];
	const id = `${reportsTo ? "worker" : "session"}-${Date.now().toString(36)}-${counter}`;
	return { id, name: reportsTo ? `Worker ${counter}` : `Session ${counter}`, status: STATUSES[counter % 3], tmuxSession, reportsTo, cwd: `~/code/${tmuxSession.toLowerCase()}`, task: counter % 2 ? `Task ${counter}` : "", tool, detail };
}

export function nextStatus(status) {
	return STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length];
}

// live.json is written by snapshot.sh: { agents: <agents.py list>, tmuxSessions: [names] }.
export function fromLive(live, coordinators) {
	return {
		coordinators: [...coordinators],
		tmuxSessions: live.tmuxSessions,
		sessions: live.agents.map((a) => ({ id: a.id, name: a.name, status: a.status, tmuxSession: a.tmuxSession, reportsTo: a.reportsTo || "", cwd: a.cwd, task: "", tool: "", detail: "" })),
	};
}

// The settled world model: coordinators stand in their headquarters; workers live in a wing per tmux session;
// independent sessions live in one building per tmux session; a tmux session with no Pi sessions is a dark building.
export function places(state) {
	const coords = state.coordinators.filter((c) => state.sessions.some((s) => s.id === c));
	const live = new Set(state.tmuxSessions);
	const headquarters = coords.map((c) => {
		const workers = state.sessions.filter((s) => s.reportsTo === c && !coords.includes(s.id));
		const wings = [...new Set(workers.map((w) => w.tmuxSession))].filter((t) => live.has(t)).map((t) => ({ key: `${c}::${t}`, tmux: t, residents: workers.filter((w) => w.tmuxSession === t) }));
		return { key: c, coordinator: state.sessions.find((s) => s.id === c), wings };
	});
	const independents = state.sessions.filter((s) => !coords.includes(s.id) && !coords.includes(s.reportsTo));
	// A tmux session gets a building when it holds independent sessions, or no Pi sessions at all (then it is dark).
	const buildings = state.tmuxSessions
		.filter((t) => independents.some((s) => s.tmuxSession === t) || !state.sessions.some((s) => s.tmuxSession === t))
		.map((t) => ({ key: t, tmux: t, residents: independents.filter((s) => s.tmuxSession === t) }));
	return { headquarters, buildings };
}
