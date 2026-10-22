import { stripVTControlCharacters } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAgentWorker } from "../../pi-exec/src/agent-workers.js";
import { READ_ONLY_CORE_TOOL_NAMES } from "../../pi-exec/src/core-tools.js";
import { getActiveWorkSurface } from "../../shared/src/active-work.js";
import { INTERN_PROMPTS } from "./prompts.js";

const NAMES = ["explore", "research"] as const;
const TRADEOFF =
	"A cheap intern is fast and keeps reading out of your context, but returns a lossy summary of only what it chose to report. It can miss, misread, or state a belief as fact. Verify findings before acting and read the source yourself when the detail decides.";

export function installInterns(pi: ExtensionAPI): void {
	const active = new Map<string, { name: string; activity: string; controller: AbortController }>();
	const surface = getActiveWorkSurface(pi);
	let tui = false;
	const unregister = surface.registerSource({
		key: "interns",
		statusKey: "interns",
		countLabel: "interns",
		getEntries: () =>
			tui
				? [...active].map(([id, call]) => ({
						id,
						render: (_width, theme, frame) => [
							`${theme.fg("dim", "\u251c\u2500")} ${theme.fg("accent", frame)} ${theme.bold(`Intern: ${call.name}`)} ${theme.fg("muted", stripVTControlCharacters(call.activity).replace(/\s+/g, " "))}`,
						],
					}))
				: [],
	});
	const cancel = () => {
		for (const call of active.values()) call.controller.abort();
		active.clear();
		surface.update();
	};
	const activate = (ctx: ExtensionContext) => {
		tui = ctx.mode === "tui";
		if (tui) surface.setUICtx(ctx.ui);
		pi.setActiveTools([...new Set([...pi.getActiveTools(), ...NAMES])]);
	};
	pi.on("session_start", (_event, ctx) => {
		cancel();
		activate(ctx);
	});
	pi.on("before_agent_start", (_event, ctx) => activate(ctx));
	pi.on("session_tree", cancel);
	pi.on("session_shutdown", () => {
		cancel();
		unregister();
	});

	for (const name of NAMES) {
		pi.registerTool(
			defineTool({
				name,
				label: `${name} intern`,
				description: `${name === "explore" ? "Ask a cheap intern to map local code or investigate the filesystem." : "Ask a cheap intern to research external sources, documentation, APIs, or libraries; optionally supply material to read."} ${TRADEOFF} One question, one answer; the process exits afterwards.`,
				promptSnippet: `${name === "explore" ? "Local repository reading" : "External research"} by a cheap, one-shot intern outside your context.`,
				promptGuidelines: [
					TRADEOFF,
					"Give an intern one specific question and enough context to investigate independently. Read a small known path yourself; assign lasting engineering work to peers.",
					"Independent intern questions can run in parallel. Each call returns its answer and releases its process; Esc cancels it.",
				],
				executionMode: "parallel",
				parameters:
					name === "research"
						? Type.Object({
								question: Type.String({
									minLength: 1,
									description: "The question to investigate, including the version or constraints that matter.",
								}),
								material: Type.Optional(
									Type.String({
										description: "Sources, URLs, excerpts, or background to read alongside the question.",
									}),
								),
							})
						: Type.Object({
								question: Type.String({
									minLength: 1,
									description: "The local question to investigate, with scope and the evidence you need.",
								}),
							}),
				async execute(id, params, signal, onUpdate, ctx) {
					if (!params.question.trim()) throw new Error("Give the intern a non-empty question.");
					const call = { name, activity: "starting", controller: new AbortController() };
					active.set(id, call);
					surface.update();
					const combinedSignal = signal ? AbortSignal.any([signal, call.controller.signal]) : call.controller.signal;
					try {
						const outcome = await runAgentWorker(
							0,
							{
								task: params.question,
								profile: "quick",
								pair: false,
								tools: [...READ_ONLY_CORE_TOOL_NAMES],
								systemPrompt: INTERN_PROMPTS[name],
								...("material" in params && params.material !== undefined
									? { context: { material: params.material } }
									: {}),
							},
							ctx,
							combinedSignal,
							(activity) => {
								if (active.get(id) !== call) return;
								call.activity = activity;
								surface.update();
								onUpdate?.({ content: [{ type: "text", text: activity }], details: undefined });
							},
						);
						const text = String(outcome.record.text ?? "");
						return {
							content: [{ type: "text", text: outcome.error ? `${outcome.error}\n\n${text}` : text }],
							details: undefined,
							...(outcome.error ? { isError: true } : {}),
							...(outcome.usage ? { usage: outcome.usage } : {}),
						};
					} finally {
						if (active.get(id) === call) {
							active.delete(id);
							surface.update();
						}
					}
				},
			}),
		);
	}
}
