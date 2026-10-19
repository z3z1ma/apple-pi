// Observed facts about each character, read from its `sessions` row the way the tmux sidebar reads them
// (`components/tmux-sessions/sidebar/model.py`), so every view agrees on who is asking, working, or finished.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CharacterFacts, Question, RunState } from "../world.js";

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
	intent: string | null;
	model: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number | null;
	tmuxSocket: string | null;
	paneId: string | null;
	tmuxSession: string | null;
	windowIndex: number | null;
}

/**
 * The facts columns for `select ... from sessions s join incarnations i ...` (the current incarnation). Without
 * `intent`, the column reads as null: a runtime started before the migration that adds it keeps running old code until
 * it restarts, and its database has no such column.
 */
export const factsColumns = (intent: boolean) => `s.run_state as runState, s.prompt, s.needs_you_since as needsYouSince,
	s.seen_at as seenAt, s.settled_at as settledAt, s.current_tool as currentTool, s.current_tool_arg as currentToolArg,
	s.current_tool_since as currentToolSince, s.current_task as currentTask, ${intent ? "s.intent" : "null as intent"},
	s.model, s.context_tokens as contextTokens,
	s.context_window as contextWindow, s.cost, i.tmux_socket as tmuxSocket, i.pane_id as paneId,
	(select ts.name from tmux_window_links l join tmux_sessions ts on ts.socket = l.socket and ts.id = l.session_id
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as tmuxSession,
	(select l.window_index from tmux_window_links l
		where l.socket = p.socket and l.window_id = p.window_id order by l.window_index limit 1) as windowIndex`;

/** Joins for `factsColumns`: the session's current incarnation `i` and its pane `p`. */
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

const PARSED_KEPT = 20_000;
const parsed = new Map<string, unknown>();

/**
 * `JSON.parse` for column values that repeat from read to read (`git`, `config`, `current_task`), parsed once each.
 * The values are shared between readers: never change one.
 */
export function parseShared<T>(json: string | null | undefined): T | undefined {
	if (!json) return undefined;
	if (parsed.has(json)) return parsed.get(json) as T | undefined;
	if (parsed.size >= PARSED_KEPT) parsed.clear();
	const value = parse<T>(json);
	parsed.set(json, value);
	return value;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The questions of an `ask_user_question` prompt, as the panel's form needs them; undefined when they do not parse. */
function questionsOf(value: unknown): Question[] | undefined {
	if (!Array.isArray(value) || !value.length) return undefined;
	const questions: Question[] = [];
	for (const raw of value as Record<string, unknown>[]) {
		const question = text(raw?.question);
		const options = Array.isArray(raw?.options)
			? (raw.options as Record<string, unknown>[]).map((option) => ({
					label: typeof option?.label === "string" ? option.label : "",
					description: typeof option?.description === "string" ? option.description : "",
				}))
			: [];
		if (!question || !options.length || options.some((option) => !option.label)) return undefined;
		questions.push({ question, header: text(raw.header), options, multiSelect: raw.multiSelect === true });
	}
	return questions;
}

/**
 * The open prompt's kind and what it asks: its title, or else its first question. A questionnaire also carries its id
 * and questions, so the conversation panel can answer it.
 */
function asking(prompt: string | null): CharacterFacts["asking"] {
	if (prompt === null) return null;
	const open = parse<{ kind?: unknown; id?: unknown; title?: unknown; questions?: unknown }>(prompt);
	const first = Array.isArray(open?.questions) ? (open.questions[0] as { question?: unknown } | undefined) : undefined;
	const kind = text(open?.kind) ?? "dialog";
	const shown = { kind, text: text(open?.title) ?? text(first?.question) };
	const questions = kind === "questionnaire" ? questionsOf(open?.questions) : undefined;
	const id = text(open?.id);
	return questions && id ? { ...shown, questionnaire: { id, questions } } : shown;
}

/**
 * Reads ledger tasks' `task.md`, again only when the file changed. With `recheck` false, a file read before is not
 * even checked for changes: the inn's thousands of sleepers are checked only on the backend's task rereads.
 */
export function taskReader(): (currentTask: string | null, recheck?: boolean) => CharacterFacts["task"] {
	const cache = new Map<string, { mtime: number; title: string | null; status: string | null }>();
	return (currentTask, recheck = true) => {
		const task = parseShared<{ bundle?: unknown; taskId?: unknown }>(currentTask);
		if (typeof task?.bundle !== "string" || typeof task.taskId !== "string") return null;
		const file = join(task.bundle, "task.md");
		let read = cache.get(file);
		if (read && !recheck) return { title: read.title || task.taskId, status: read.status || null, bundle: task.bundle };
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
			// Gone, as after the task is archived: remembered as unread, so the next check stats it again.
			read = { mtime: -1, title: null, status: null };
			cache.set(file, read);
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
		intent: text(row.intent),
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
