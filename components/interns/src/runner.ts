import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AgentSessionEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ANTHROPIC_WATCHDOG_EXTENSION_PATH } from "../../../extensions/anthropic-watchdog.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../../../extensions/auto-compact.js";
import { CODE_CONTEXT_EXTENSION_PATH, CONTEXT_LINT_TOOL_NAME } from "../../../extensions/code-context.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../../../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../../../extensions/ledger.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../../../extensions/session-search.js";
import { VROOM_EXTENSION_PATH } from "../../../extensions/vroom.js";
import { WIKI_EXTENSION_PATH, WIKI_TOOL_NAMES } from "../../../extensions/wiki.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { createTurnObserver, type TurnResult } from "../../shared/src/turn-observer.js";
import { INTERN_PROMPTS } from "./prompts.js";

export type InternKind = keyof typeof INTERN_PROMPTS;

export function buildInternCliArgs(
	kind: InternKind,
	question: string,
	options: { projectTrusted: boolean; model: string; thinking: string; materialPath?: string },
): string[] {
	const args = [
		"--mode",
		"json",
		"--print",
		"--no-session",
		options.projectTrusted ? "--approve" : "--no-approve",
		"--no-extensions",
		"--no-skills",
		"--tools",
		["read", "grep", "find", "ls", "bash", ...WIKI_TOOL_NAMES, CONTEXT_LINT_TOOL_NAME].join(","),
		"--append-system-prompt",
		[
			INTERN_PROMPTS[kind],
			options.materialPath ? "Use the attached JSON material as source data for this question." : "",
		]
			.filter(Boolean)
			.join("\n\n"),
		"--model",
		options.model,
		"--thinking",
		options.thinking,
		"--extension",
		AUTO_COMPACT_EXTENSION_PATH,
		"--extension",
		ANTHROPIC_WATCHDOG_EXTENSION_PATH,
		"--extension",
		VROOM_EXTENSION_PATH,
		"--extension",
		HOME_SEARCH_GUARD_EXTENSION_PATH,
		"--extension",
		LEDGER_EXTENSION_PATH,
		"--extension",
		WIKI_EXTENSION_PATH,
		"--extension",
		CODE_CONTEXT_EXTENSION_PATH,
		"--extension",
		SESSION_SEARCH_EXTENSION_PATH,
	];
	if (options.materialPath) args.push(`@${options.materialPath}`);
	args.push("--", question);
	return args;
}

function invocation(): { command: string; prefix: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && existsSync(script))
		return { command: process.execPath, prefix: [script] };
	const executable = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(executable)
		? { command: "pi", prefix: [] }
		: { command: process.execPath, prefix: [] };
}

export async function runIntern(
	kind: InternKind,
	question: string,
	material: string | undefined,
	ctx: ExtensionContext,
	signal: AbortSignal,
	onActivity: (activity: string) => void,
): Promise<TurnResult> {
	signal.throwIfAborted();
	const { model, thinking } = resolveModelProfile("quick", ctx.modelRegistry);
	const dir = material === undefined ? undefined : mkdtempSync(join(tmpdir(), "pi-intern-"));
	try {
		const materialPath = dir ? join(dir, "context.json") : undefined;
		if (materialPath) writeFileSync(materialPath, JSON.stringify({ material }), { encoding: "utf8", mode: 0o600 });
		const args = buildInternCliArgs(kind, question, {
			projectTrusted: ctx.isProjectTrusted?.() === true,
			model: `${model.provider}/${model.id}`,
			thinking,
			materialPath,
		});
		const pi = invocation();
		return await new Promise<TurnResult>((resolve) => {
			const child = spawn(pi.command, [...pi.prefix, ...args], {
				cwd: ctx.cwd,
				detached: process.platform !== "win32",
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stderr = "";
			let buffered = "";
			let error: string | undefined;
			let aborted = false;
			const observer = createTurnObserver(ctx.cwd, (progress) => onActivity(progress.activity));
			const consume = (line: string) => {
				if (!line.trim()) return;
				try {
					observer.observe(JSON.parse(line) as AgentSessionEvent);
				} catch (cause) {
					error = `Invalid Pi event: ${cause instanceof Error ? cause.message : String(cause)}`;
				}
			};
			child.stdout.on("data", (chunk) => {
				buffered += chunk.toString();
				const lines = buffered.split("\n");
				buffered = lines.pop() ?? "";
				for (const line of lines) consume(line);
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			const abort = () => {
				aborted = true;
				// Pi's SIGTERM handler stops its detached tool processes before disposing the session.
				child.kill("SIGTERM");
			};
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
			child.on("error", (cause) => {
				error = cause.message;
			});
			child.on("close", (code) => {
				signal.removeEventListener("abort", abort);
				if (buffered.trim()) consume(buffered);
				if (!error && code !== 0) error = stderr.trim() || `Intern exited with code ${code ?? 1}`;
				resolve(observer.finish({ aborted, error }));
			});
		});
	} finally {
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
}
