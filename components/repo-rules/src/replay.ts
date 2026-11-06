import { join, relative, resolve } from "node:path";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { git } from "../../shared/src/git.js";
import { sessionEntries, within } from "../../shared/src/session-logs.js";
import { runRules } from "./grit.js";
import { includedBy, rulesRootOf } from "./policy.js";

export const REPLAY_RULE_TOOL_NAME = "replay_rule";

export interface ReplayCandidate {
	grit?: string;
	includes?: string[];
	pattern?: string;
}

export interface ReplayHit {
	at: string;
	ref: string;
	path?: string;
	command?: string;
	lines?: number[];
}

export interface ReplayReport {
	sessions: number;
	evaluated: number;
	hits: ReplayHit[];
	notEvaluated: { at: string; ref: string; path: string; reason: string }[];
}

interface Job {
	at: string;
	ref: string;
	path: string;
	content: string;
}

interface ToolCall {
	type?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

function addedTexts(call: ToolCall): string[] {
	const args = call.arguments ?? {};
	if (call.name === "write") return typeof args.content === "string" ? [args.content] : [];
	const edits = Array.isArray(args.edits) ? (args.edits as { newText?: unknown }[]) : [args];
	return edits.flatMap((edit) => (typeof edit.newText === "string" ? [edit.newText] : []));
}

export async function replayRule(
	candidate: ReplayCandidate,
	options: { root: string; since: number; sessionsDir: string },
): Promise<ReplayReport> {
	const pattern = candidate.pattern === undefined ? undefined : new RegExp(candidate.pattern);
	const wantedTools = pattern ? ["bash"] : ["edit", "write"];
	const sessions = new Set<string>();
	const jobs: Job[] = [];
	const hits: ReplayHit[] = [];
	let evaluated = 0;
	for await (const { session, entry } of sessionEntries({
		...options,
		wanted: (line) => line.includes('"toolCall"') && line.includes('"assistant"'),
	})) {
		const message = entry.message as { role?: string; content?: ToolCall[] } | undefined;
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		sessions.add(session.id);
		const at = entry.timestamp as string;
		const ref = `entry:${session.id}/${entry.id}`;
		for (const call of message.content) {
			if (call.type !== "toolCall" || !wantedTools.includes(call.name ?? "")) continue;
			const args = call.arguments ?? {};
			if (pattern) {
				if (typeof args.command !== "string") continue;
				evaluated++;
				if (pattern.test(args.command)) hits.push({ at, ref, command: args.command });
				continue;
			}
			if (typeof args.path !== "string") continue;
			const absolute = resolve(session.cwd, args.path);
			if (!within(options.root, absolute)) continue;
			const path = relative(options.root, absolute);
			if (!includedBy(candidate.includes, path)) continue;
			for (const content of addedTexts(call)) jobs.push({ at, ref, path, content });
		}
	}
	const notEvaluated: ReplayReport["notEvaluated"] = [];
	if (candidate.grit !== undefined && jobs.length) {
		const runs = await runRules(jobs.map((job) => ({ query: candidate.grit!, path: job.path, content: job.content })));
		for (const [index, run] of runs.entries()) {
			const job = jobs[index]!;
			if (run.failure) {
				notEvaluated.push({ at: job.at, ref: job.ref, path: job.path, reason: run.failure });
				continue;
			}
			evaluated++;
			if (run.lines.length) hits.push({ at: job.at, ref: job.ref, path: job.path, lines: run.lines });
		}
	}
	hits.sort((a, b) => a.at.localeCompare(b.at));
	return { sessions: sessions.size, evaluated, hits, notEvaluated };
}

export async function windowStart(root: string, since: string): Promise<number> {
	if (/^\d{4}-\d{2}-\d{2}/.test(since)) {
		const at = Date.parse(since);
		if (Number.isNaN(at)) throw new Error(`${since} is not a date`);
		return at;
	}
	const committed = await git(root, ["log", "-1", "--format=%cI", since, "--"]).catch(() => "");
	if (!committed) throw new Error(`${since} is neither a date nor a revision of ${root}`);
	return Date.parse(committed);
}

export async function repositoryRoot(cwd: string): Promise<string> {
	return rulesRootOf(join(cwd, "x")) ?? ((await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")) || cwd);
}

export function createReplayTool() {
	return defineTool({
		name: REPLAY_RULE_TOOL_NAME,
		label: "Replay rule",
		description:
			"Replay a candidate rule over this repository's recorded sessions since a date or commit: a GritQL rule on the text edits and writes added, or an action pattern on shell commands. Lists what it would have refused, with search_session entry references, and what it could not evaluate. Records no firings.",
		parameters: Type.Object(
			{
				grit: Type.Optional(
					Type.String({
						minLength: 1,
						description: "GritQL query as in a .grit file, starting with its language line.",
					}),
				),
				includes: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), {
						description:
							"Globs relative to the repository root that a code rule applies to; ! excludes, as in policy.json.",
					}),
				),
				pattern: Type.Optional(
					Type.String({ minLength: 1, description: "Regular expression an action rule tests shell commands with." }),
				),
				since: Type.String({
					minLength: 1,
					description: "Window start: a date or a git revision, usually the last change to what the rule guards.",
				}),
				limit: Type.Integer({ minimum: 1, description: "How many refused actions to list." }),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params, _signal, _update, ctx) {
			if ((params.grit === undefined) === (params.pattern === undefined))
				throw new Error("Give either grit (a code rule) or pattern (an action rule).");
			const root = await repositoryRoot(ctx.cwd);
			const since = await windowStart(root, params.since);
			const report = await replayRule(params, { root, since, sessionsDir: join(getAgentDir(), "sessions") });
			const what = params.pattern === undefined ? "edits and writes" : "shell commands";
			const listed = report.hits.slice(0, params.limit);
			const lines = [
				`Replayed over ${report.evaluated} recorded ${what} in ${report.sessions} sessions of ${root} since ${new Date(since).toISOString()} (${params.since}).`,
				`Would have refused ${report.hits.length}${listed.length < report.hits.length ? `, first ${listed.length} listed` : ""}:`,
				...listed.map(
					(hit) =>
						`- ${hit.at} ${hit.ref} ${hit.command !== undefined ? JSON.stringify(hit.command.slice(0, 200)) : `${hit.path} added text line ${hit.lines!.join(", ")}`}`,
				),
				...(report.notEvaluated.length
					? [
							`Not evaluated: ${report.notEvaluated.length}, for example ${report.notEvaluated[0]!.path} (${report.notEvaluated[0]!.ref}): ${report.notEvaluated[0]!.reason}`,
						]
					: []),
			];
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { ...report, hits: listed, notEvaluated: report.notEvaluated.slice(0, params.limit) },
			};
		},
	});
}
