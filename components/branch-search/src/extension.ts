import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import { liveSession, trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { type BranchSearchConfig, readBranchSearchConfig, validateBranchSearchConfig } from "./config.js";
import { type ProfileRequest, runBranchSearch } from "./orchestrator.js";

const TOOL_NAME = "search_branches";
const ALONE = `Call ${TOOL_NAME} on its own, as the only tool call in its message, so the search can fork the conversation at this call.`;
const IN_FORK = `${TOOL_NAME} is not available inside a forked continuation.`;
const RUNNING = "A branch search is already running in this session.";

/** The configuration, or the text that says why it cannot be used. */
function loadConfig(
	ctx: ExtensionContext,
): { ok: true; config: BranchSearchConfig } | { ok: false; text: string; level: "error" | "warning" } {
	let raw: unknown;
	try {
		raw = readBranchSearchConfig(ctx.cwd, ctx.isProjectTrusted());
	} catch (error) {
		return { ok: false, text: error instanceof Error ? error.message : String(error), level: "error" };
	}
	const validated = validateBranchSearchConfig(raw);
	return validated.ok ? validated : { ...validated, level: "warning" };
}

/** True when `toolCallId` is the only tool call of the message the conversation ends with. */
function callsAlone(messages: AgentMessage[], toolCallId: string): boolean {
	const last = messages.at(-1);
	if (last?.role !== "assistant") return false;
	const calls = last.content.filter((block) => block.type === "toolCall");
	return calls.length === 1 && calls[0]?.id === toolCallId;
}

/** The fork prompt as the result of the pending `search_branches` call, so the fork point ends with that call. */
function answerCall(toolCallId: string): (prompt: string) => AgentMessage {
	return (prompt) => ({
		role: "toolResult",
		toolCallId,
		toolName: TOOL_NAME,
		content: [{ type: "text", text: prompt }],
		isError: false,
		timestamp: Date.now(),
	});
}

/** One request on a user-global model profile, without the conversation or tools: the judge model. */
export function profileRequest(
	registry: Pick<ExtensionContext["modelRegistry"], "find" | "streamSimple">,
): ProfileRequest {
	return async (profile, prompt, signal) => {
		const { model, thinking } = resolveModelProfile(profile, registry);
		const reply = await registry
			.streamSimple(
				model,
				{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
				{ signal, ...(thinking === "off" ? {} : { reasoning: thinking }) },
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted")
			throw new Error(reply.errorMessage ?? reply.stopReason);
		const text = reply.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n")
			.trim();
		return { text, usage: reply.usage };
	};
}

/**
 * The `search_branches` tool. One search per root session; the call blocks until the search ends and
 * returns the report as its result. Aborting the call, session switch, tree navigation, and shutdown
 * cancel the search, which still cleans up.
 */
export default function registerBranchSearch(pi: ExtensionAPI): void {
	trackLiveSessions();
	/** The running search: aborting its controller cancels it; `done` settles once it has cleaned up. */
	let active: { controller: AbortController; done: Promise<void> } | undefined;
	/** Cancel the search and wait until its worktrees, refs, and record are final. */
	const cancelForSession = async () => {
		const search = active;
		if (!search) return;
		search.controller.abort();
		await search.done;
	};
	pi.on("session_start", cancelForSession);
	pi.on("session_tree", cancelForSession);
	pi.on("session_shutdown", cancelForSession);

	pi.registerTool({
		name: TOOL_NAME,
		label: "Search Branches",
		description:
			"Run several distinct implementation approaches in parallel, each in its own git worktree, and keep the one that scores best. " +
			"You write the judges: shell commands whose last stdout line is one number, each with the direction that is better. " +
			"Gates are pass/fail commands, such as the test suite, that every winning attempt must pass. " +
			"Before scoring, protected paths are put back to their base content in each attempt. " +
			"Among the attempts that pass every gate, the best judge numbers (the median of each judge's runs) win; the winner is applied when the workspace is unchanged, and the report is returned.",
		promptSnippet:
			"Run several approaches in parallel worktrees and keep the one that scores best on judge commands you write",
		promptGuidelines: [
			`Use ${TOOL_NAME} when several distinct approaches are plausible and a command can measure which result is better: time, memory, size, a complexity score, or any quality number a command prints. Each judge is a shell command whose last stdout line is one number, with better "lower" or "higher"; add the test suite as a gate. When the user suggests a measure, use it as the judge. Set repeat for a noisy measure such as time. List in protect every file the judges and gates read, such as benchmarks and tests. Set timeoutSec on any command that could hang. Call it alone in its message; it applies the winner and returns the report.`,
		],
		parameters: Type.Object({
			goal: Type.String({ description: "The observable result that must hold when the work is done." }),
			judges: Type.Array(
				Type.Object({
					command: Type.String({
						description:
							"Shell command run in each attempt's worktree; its last stdout line is one number, such as milliseconds or bytes.",
					}),
					better: Type.Union([Type.Literal("lower"), Type.Literal("higher")], {
						description: "Which direction of the number is better.",
					}),
					repeat: Type.Optional(
						Type.Integer({
							minimum: 1,
							description:
								"Runs per attempt, ranked by their median; set it for a noisy measure such as time. Default 1.",
						}),
					),
					timeoutSec: Type.Optional(
						Type.Number({
							exclusiveMinimum: 0,
							description: "Seconds each run may take; a run that takes longer fails the attempt.",
						}),
					),
				}),
				{ minItems: 1, description: "Ranked in order: the first judge decides, later ones break ties." },
			),
			gates: Type.Optional(
				Type.Array(
					Type.Union([
						Type.String(),
						Type.Object({
							command: Type.String(),
							timeoutSec: Type.Optional(
								Type.Number({
									exclusiveMinimum: 0,
									description: "Seconds the gate may take; a gate that takes longer fails.",
								}),
							),
						}),
					]),
					{
						description:
							"Pass/fail shell commands, such as the test suite; a winning attempt passes every one (exit 0). A command string, or { command, timeoutSec } for a command that could hang.",
					},
				),
			),
			protect: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Repository-relative files or directories the judges and gates read, such as benchmarks and tests. Every attempt is scored, and the winner applied, with their base content.",
				}),
			),
		}),
		executionMode: "sequential",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (inForkedContinuation()) throw new Error(IN_FORK);
			if (active) throw new Error(RUNNING);
			const session = liveSession(ctx);
			if (!session) throw new Error("Branch search is not available: the live session is not available.");
			if (!callsAlone(session.sessionManager.buildSessionProjection().messages, toolCallId)) throw new Error(ALONE);
			if (params.judges.length === 0) throw new Error(`${TOOL_NAME} needs at least one judge.`);
			const validated = loadConfig(ctx);
			if (!validated.ok) throw new Error(validated.text);
			const controller = new AbortController();
			const cancel = () => controller.abort();
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
			const run = runBranchSearch({
				session,
				cwd: ctx.cwd,
				config: validated.config,
				goal: params.goal,
				judges: params.judges,
				gates: params.gates ?? [],
				protect: params.protect ?? [],
				forkPointPrompt: answerCall(toolCallId),
				profileRequest: profileRequest(ctx.modelRegistry),
				signal: controller.signal,
				onStatus: (text) => {
					if (text !== undefined) onUpdate?.({ content: [{ type: "text", text }], details: undefined });
				},
			});
			const search = {
				controller,
				done: run.then(
					() => undefined,
					() => undefined,
				),
			};
			active = search;
			try {
				const result = await run;
				return {
					content: [{ type: "text", text: result.report }],
					details: { outcome: result.outcome, recordPath: result.recordPath },
				};
			} finally {
				signal?.removeEventListener("abort", cancel);
				if (active === search) active = undefined;
			}
		},
	});
}
