import { readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { git } from "../../shared/src/git.js";
import { canonical, sessionEntries, within } from "../../shared/src/session-logs.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import { addedTexts, callEvent, editEvent, type RecordedCall, type RuleEvent } from "./events.js";
import { runRules } from "./grit.js";
import { gritPath, includedBy, ruleSetsFor, rulesRootOf, type ScriptRule, scriptPath } from "./policy.js";
import { runScripts } from "./scripts.js";

export const REPLAY_RULE_TOOL_NAME = "replay_rule";

export interface ReplayCandidate {
	grit?: string;
	includes?: string[];
	pattern?: string;
	script?: string;
	on?: ScriptRule["on"];
	message?: string;
}

export interface ReplayHit {
	at: string;
	ref: string;
	file: string;
	path?: string;
	command?: string;
	lines?: number[];
	reasons?: string[];
}

export interface ReplayReport {
	sessions: number;
	evaluated: number;
	hits: ReplayHit[];
	notEvaluated: { at: string; ref: string; file: string; path: string; reason: string }[];
}

interface Job {
	at: string;
	ref: string;
	file: string;
	path: string;
	content: string;
}

interface ToolCall {
	type?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

interface PendingEvent {
	at: string;
	ref: string;
	file: string;
	event: RuleEvent;
}

const REPLAY_BATCH_BYTES = 8 << 20;

export const byInstant = (a: { at: string }, b: { at: string }) => Date.parse(a.at) - Date.parse(b.at);

export async function replayRule(
	candidate: ReplayCandidate,
	options: { root: string; since: number; sessionsDir: string },
): Promise<ReplayReport> {
	if (candidate.script !== undefined) return replayScript(candidate as ScriptCandidate, options);
	const pattern = candidate.pattern === undefined ? undefined : new RegExp(candidate.pattern);
	const wantedTools = pattern ? ["bash"] : ["edit", "write"];
	const root = canonical(options.root);
	const sessions = new Set<string>();
	const hits: ReplayHit[] = [];
	const notEvaluated: ReplayReport["notEvaluated"] = [];
	let jobs: Job[] = [];
	let pendingBytes = 0;
	let evaluated = 0;
	const runJobs = async () => {
		if (candidate.grit === undefined || !jobs.length) return;
		const batch = jobs;
		jobs = [];
		pendingBytes = 0;
		const runs = await runRules(batch.map((job) => ({ query: candidate.grit!, path: job.path, content: job.content })));
		for (const [index, run] of runs.entries()) {
			const { content: _content, ...job } = batch[index]!;
			if (run.failure) {
				notEvaluated.push({ ...job, reason: run.failure });
				continue;
			}
			evaluated++;
			if (run.lines.length) hits.push({ ...job, lines: run.lines });
		}
	};
	let file: string | undefined;
	for await (const { session, entry } of sessionEntries({
		...options,
		wanted: (line) => line.includes('"toolCall"') && line.includes('"assistant"'),
	})) {
		if (session.file !== file) {
			await runJobs();
			file = session.file;
		}
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
				if (pattern.test(args.command)) hits.push({ at, ref, file: session.file, command: args.command });
				continue;
			}
			if (typeof args.path !== "string") continue;
			const absolute = recordedPath(args.path, session.cwd);
			if (typeof absolute !== "string") {
				notEvaluated.push({ at, ref, file: session.file, path: args.path, reason: absolute.reason });
				continue;
			}
			if (!within(root, absolute)) continue;
			const path = relative(root, absolute);
			if (!includedBy(candidate.includes, path)) continue;
			const added = addedTexts(call.name ?? "", args);
			if ("reason" in added) {
				notEvaluated.push({ at, ref, file: session.file, path, reason: added.reason });
				continue;
			}
			for (const content of added.texts) {
				jobs.push({ at, ref, file: session.file, path, content });
				pendingBytes += content.length;
			}
			if (pendingBytes >= REPLAY_BATCH_BYTES) await runJobs();
		}
	}
	await runJobs();
	hits.sort(byInstant);
	notEvaluated.sort(byInstant);
	return { sessions: sessions.size, evaluated, hits, notEvaluated };
}

type ScriptCandidate = ReplayCandidate & { script: string };

function recordedEvents(
	candidate: ScriptCandidate,
	root: string,
	cwd: string,
	content: ToolCall[],
): ({ event: RuleEvent } | { path: string; reason: string })[] {
	const calls = content
		.filter((part) => part.type === "toolCall" && typeof part.name === "string")
		.map(
			(part, index): RecordedCall => ({
				id: part.id ?? `call-${index}`,
				name: part.name!,
				arguments: part.arguments ?? {},
			}),
		);
	if ((candidate.on ?? "call") === "call")
		return calls.map((call) => ({ event: callEvent(call, calls, cwd, root, false) }));
	return calls.flatMap((call): ({ event: RuleEvent } | { path: string; reason: string })[] => {
		const args = call.arguments ?? {};
		if ((call.name !== "edit" && call.name !== "write") || typeof args.path !== "string") return [];
		const absolute = recordedPath(args.path, cwd);
		if (typeof absolute !== "string") return [{ path: args.path, reason: absolute.reason }];
		const path = relative(root, absolute);
		if (!within(root, absolute) || !includedBy(candidate.includes, path)) return [];
		const added = addedTexts(call.name, args);
		if ("reason" in added) return [{ path, reason: added.reason }];
		const content = call.name === "write" ? added.texts[0]! : null;
		return [{ event: editEvent(call.name, absolute, root, content, added.texts) }];
	});
}

async function replayScript(
	candidate: ScriptCandidate,
	options: { root: string; since: number; sessionsDir: string },
): Promise<ReplayReport> {
	const root = canonical(options.root);
	const sessions = new Set<string>();
	const hits: ReplayHit[] = [];
	const notEvaluated: ReplayReport["notEvaluated"] = [];
	let evaluated = 0;
	let pending: PendingEvent[] = [];
	let pendingBytes = 0;
	const run = async () => {
		if (!pending.length) return;
		const batch = pending;
		pending = [];
		pendingBytes = 0;
		const rows = await runScripts(
			[{ id: "candidate", on: candidate.on ?? "call", body: candidate.script }],
			batch.map((each) => each.event),
			new Map([["candidate", candidate.message]]),
		);
		for (const [index, row] of rows.entries()) {
			const { at, ref, file, event } = batch[index]!;
			const outcome = row.get("candidate");
			const path = event.on === "edit" ? event.path : (event.path ?? "");
			if (!outcome) continue;
			if ("error" in outcome) {
				notEvaluated.push({ at, ref, file, path, reason: outcome.error });
				continue;
			}
			evaluated++;
			if (!outcome.reasons.length) continue;
			const command = event.on === "call" && typeof event.input.command === "string" ? event.input.command : undefined;
			hits.push({
				at,
				ref,
				file,
				...(path ? { path } : {}),
				...(command === undefined ? {} : { command }),
				reasons: outcome.reasons,
			});
		}
	};
	for await (const { session, entry } of sessionEntries({
		...options,
		wanted: (line) => line.includes('"toolCall"') && line.includes('"assistant"'),
	})) {
		const message = entry.message as { role?: string; content?: ToolCall[] } | undefined;
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		sessions.add(session.id);
		const at = entry.timestamp as string;
		const ref = `entry:${session.id}/${entry.id}`;
		for (const item of recordedEvents(candidate, root, canonical(session.cwd), message.content)) {
			if ("reason" in item) {
				notEvaluated.push({ at, ref, file: session.file, ...item });
				continue;
			}
			pending.push({ at, ref, file: session.file, event: item.event });
			pendingBytes += JSON.stringify(item.event).length;
			if (pendingBytes >= REPLAY_BATCH_BYTES) await run();
		}
	}
	await run();
	hits.sort(byInstant);
	notEvaluated.sort(byInstant);
	return { sessions: sessions.size, evaluated, hits, notEvaluated };
}

function recordedPath(path: string, cwd: string): string | { reason: string } {
	try {
		const lexical = resolveToolPath(path, cwd);
		return join(canonical(dirname(lexical)), basename(lexical));
	} catch (error) {
		return { reason: `its path does not resolve: ${(error as Error).message}` };
	}
}

export function existingRule(cwd: string, wanted: string): ReplayCandidate & { source: string } {
	const [level, id] = /^(user|project):/.test(wanted) ? wanted.split(/:(.*)/s) : [undefined, wanted];
	const found: (ReplayCandidate & { source: string })[] = [];
	for (const set of ruleSetsFor(join(cwd, "x"))) {
		if (level && set.level !== level) continue;
		const source = `${set.level}:${id}`;
		const grit = (set.policy.rules ?? []).find((rule) => rule.grit === id || rule.grit === `${id}.grit`);
		if (grit) found.push({ source, grit: readFileSync(gritPath(set, grit), "utf8"), includes: grit.includes });
		const action = (set.policy.actions ?? []).find((rule) => rule.id === id);
		if (action) found.push({ source, pattern: action.pattern });
		const script = (set.policy.scripts ?? []).find((rule) => rule.id === id);
		if (script)
			found.push({
				source,
				script: readFileSync(scriptPath(set, script), "utf8"),
				on: script.on,
				includes: script.includes,
				message: script.message,
			});
	}
	if (found.length === 1) return found[0]!;
	if (!found.length) throw new Error(`No rule ${wanted} applies here; repo_rules lists them.`);
	throw new Error(`${wanted} names ${found.length} rules; choose one: ${found.map((each) => each.source).join(", ")}.`);
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
			"Replay one rule over this repository's recorded sessions since a date or commit: an existing rule by id, or a candidate (GritQL, action pattern, or script). Lists what it would have refused, with entry references, and what it could not evaluate. Records no firings.",
		parameters: Type.Object(
			{
				rule: Type.Optional(
					Type.String({
						minLength: 1,
						description: "Id of an existing rule; user:<id> or project:<id> picks a level.",
					}),
				),
				grit: Type.Optional(Type.String({ minLength: 1, description: "GritQL query with its language line." })),
				pattern: Type.Optional(Type.String({ minLength: 1, description: "Action rule regular expression." })),
				script: Type.Optional(Type.String({ minLength: 1, description: "Script rule body." })),
				on: Type.Optional(Type.Union([Type.Literal("call"), Type.Literal("edit")])),
				includes: Type.Optional(
					Type.Array(Type.String({ minLength: 1 }), { description: "Path globs, as in policy.json." }),
				),
				since: Type.String({
					minLength: 1,
					description: "Window start: a date or a git revision, usually the last change to what the rule guards.",
				}),
				limit: Type.Integer({ minimum: 1, description: "How many refusals to list." }),
			},
			{ additionalProperties: false },
		),
		async execute(_id, params, _signal, _update, ctx) {
			const existing = params.rule ? existingRule(ctx.cwd, params.rule) : undefined;
			const candidate: ReplayCandidate = existing ?? params;
			const kinds = [candidate.grit, candidate.pattern, candidate.script].filter((each) => each !== undefined);
			if (kinds.length !== 1) throw new Error("Give exactly one of rule, grit, pattern or script.");
			const root = await repositoryRoot(ctx.cwd);
			const since = await windowStart(root, params.since);
			const report = await replayRule(candidate, { root, since, sessionsDir: join(getAgentDir(), "sessions") });
			const what =
				candidate.script !== undefined && (candidate.on ?? "call") === "call"
					? "tool calls"
					: candidate.pattern === undefined
						? "edits and writes"
						: "shell commands";
			const listed = report.hits.slice(0, params.limit);
			const lines = [
				`Replayed ${existing ? `${existing.source} ` : ""}over ${report.evaluated} recorded ${what} in ${report.sessions} sessions of ${root} since ${new Date(since).toISOString()} (${params.since}).`,
				...(candidate.script !== undefined && candidate.on === "edit"
					? [
							"Recorded edits carry no file, so `content` was null for edits and the written text for writes; a rule that needs `content` judged writes only.",
						]
					: []),
				`Would have refused ${report.hits.length}${listed.length < report.hits.length ? `, first ${listed.length} listed` : ""}:`,
				...listed.map(
					(hit) =>
						`- ${hit.at} ${hit.ref} in ${hit.file}: ${hit.reasons ? `${hit.path ?? ""} ${hit.command === undefined ? "" : JSON.stringify(hit.command.slice(0, 120))} ${hit.reasons.join("; ").slice(0, 300)}` : hit.command !== undefined ? JSON.stringify(hit.command.slice(0, 200)) : `${hit.path} added text line ${hit.lines!.join(", ")}`}`,
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
