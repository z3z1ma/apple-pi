// Observed facts about each character, read from its `sessions` row the way the tmux sidebar reads them
// (`components/tmux-sessions/sidebar/model.py`), so every view agrees on who is asking, working, or finished.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CharacterFacts, RunState } from "../world.js";

/** The `sessions` columns, with its current pane, that the facts come from. */
export interface FactsRow {
	cwd: string;
	reportsTo: string | null;
	git: string | null;
	runState: string;
	prompt: string | null;
	needsYouSince: number | null;
	seenAt: number | null;
	settledAt: number | null;
	currentTool: string | null;
	currentToolArg: string | null;
	currentToolSince: number | null;
	currentTask: string | null;
	model: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number | null;
	tmuxSocket: string | null;
	paneId: string | null;
	tmuxSession: string | null;
	windowIndex: number | null;
}

/** The facts columns for `select ... from sessions s join incarnations i ...` (the current incarnation). */
export const FACTS_COLUMNS = `s.run_state as runState, s.prompt, s.needs_you_since as needsYouSince, s.seen_at as seenAt,
	s.settled_at as settledAt, s.current_tool as currentTool, s.current_tool_arg as currentToolArg,
	s.current_tool_since as currentToolSince, s.current_task as currentTask, s.model, s.context_tokens as contextTokens,
	s.context_window as contextWindow, s.cost, i.tmux_socket as tmuxSocket, i.pane_id as paneId,
	(select ts.name from tmux_window_links l join tmux_sessions ts on ts.socket = l.socket and ts.id = l.session_id
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as tmuxSession,
	(select l.window_index from tmux_window_links l
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as windowIndex`;

/** Joins for `FACTS_COLUMNS`: the session's current incarnation `i` and its pane `p`. */
export const FACTS_JOINS = `left join incarnations i on i.session_id = s.id and i.generation = s.generation
left join tmux_panes p on p.socket = i.tmux_socket and p.id = i.pane_id`;

function parse<T>(json: string | null): T | undefined {
	if (!json) return undefined;
	try {
		return JSON.parse(json) as T;
	} catch {
		return undefined;
	}
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The open prompt's kind and what it asks: its title, or else its first question. */
function asking(prompt: string | null): CharacterFacts["asking"] {
	if (prompt === null) return null;
	const open = parse<{ kind?: unknown; title?: unknown; questions?: unknown }>(prompt);
	const first = Array.isArray(open?.questions) ? (open.questions[0] as { question?: unknown } | undefined) : undefined;
	return { kind: text(open?.kind) ?? "dialog", text: text(open?.title) ?? text(first?.question) };
}

/** Reads ledger tasks' `task.md`, again only when the file changed. */
export function taskReader(): (currentTask: string | null) => CharacterFacts["task"] {
	const cache = new Map<string, { mtime: number; title: string | null; status: string | null }>();
	return (currentTask) => {
		const task = parse<{ bundle?: unknown; taskId?: unknown }>(currentTask);
		if (typeof task?.bundle !== "string" || typeof task.taskId !== "string") return null;
		const file = join(task.bundle, "task.md");
		let read = cache.get(file);
		try {
			const mtime = statSync(file).mtimeMs;
			if (read?.mtime !== mtime) {
				// As the sidebar reads it: the first `# ` heading and the first `Status:` line.
				let title: string | null = null;
				let status: string | null = null;
				for (const line of readFileSync(file, "utf8").split("\n")) {
					if (status === null && line.startsWith("Status:")) status = line.slice("Status:".length).trim();
					else if (title === null && line.startsWith("# ")) title = line.slice(2).trim();
				}
				read = { mtime, title, status };
				cache.set(file, read);
			}
		} catch {
			read = undefined;
			cache.delete(file);
		}
		return { title: read?.title || task.taskId, status: read?.status || null, bundle: task.bundle };
	};
}

export function factsOf(
	row: FactsRow,
	readTask: (currentTask: string | null) => CharacterFacts["task"],
): CharacterFacts {
	const open = asking(row.prompt);
	const git = parse<{ repository?: unknown; worktree?: unknown; branch?: unknown }>(row.git);
	return {
		run: row.runState as RunState,
		status: open ? "asking" : row.runState !== "idle" ? "working" : "idle",
		asking: open,
		needsYouSince: row.needsYouSince,
		unseen: row.needsYouSince !== null && open === null,
		seenAt: row.seenAt,
		settledAt: row.settledAt,
		tool: row.currentTool ? { name: row.currentTool, arg: row.currentToolArg, since: row.currentToolSince } : null,
		task: readTask(row.currentTask),
		git:
			git && typeof git.repository === "string"
				? { repository: git.repository, worktree: String(git.worktree ?? ""), branch: String(git.branch ?? "") }
				: null,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		model: row.model,
		contextTokens: row.contextTokens,
		contextWindow: row.contextWindow,
		cost: row.cost ?? 0,
		tmux:
			row.tmuxSocket && row.paneId
				? { socket: row.tmuxSocket, pane: row.paneId, session: row.tmuxSession, window: row.windowIndex }
				: null,
	};
}
