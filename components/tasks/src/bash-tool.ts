import { spawn } from "node:child_process";
import {
	createBashToolDefinition as createDefaultBashToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	getShellConfig,
	type AgentToolResult,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { OutputBuffer } from "./output-buffer.js";
import { killProcessTree } from "./process-killer.js";
import type { TaskManager } from "./task-manager.js";
import {
	type BackgroundTask,
	type BashParameters,
	bashParameters,
	type ExecBashParameters,
	execBashParameters,
} from "./types.js";
import { rewriteCommand } from "../../rtk/src/index.js";

const BASH_UPDATE_THROTTLE_MS = 100;

function resolveShellEnv(ctx?: ExtensionContext): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.PI_SESSION_ID;
	delete env.PI_SESSION_FILE;
	delete env.PI_PROVIDER;
	delete env.PI_MODEL;
	delete env.PI_REASONING_LEVEL;

	if (ctx) {
		const sessionId = ctx.sessionManager?.getSessionId?.();
		if (sessionId) env.PI_SESSION_ID = sessionId;
		const sessionFile = ctx.sessionManager?.getSessionFile?.();
		if (sessionFile) env.PI_SESSION_FILE = sessionFile;
		if (ctx.model) {
			env.PI_PROVIDER = ctx.model.provider;
			env.PI_MODEL = ctx.model.id;
		}
		if (ctx.thinkingLevel) {
			env.PI_REASONING_LEVEL = ctx.thinkingLevel;
		}
	}
	return env;
}

export interface PreparedShellCommand {
	readonly command: string;
	readonly cwd: string;
	readonly isRtk: boolean;
	start(): ReturnType<typeof spawn>;
}

export async function prepareShellCommand(
	cwd: string,
	params: BashParameters | ExecBashParameters,
	signal: AbortSignal | undefined,
	ctx: ExtensionContext | undefined,
	allowRtk: boolean,
): Promise<PreparedShellCommand> {
	const { command, stdin } = params;
	const verbatim = (params as BashParameters).verbatim === true;
	const effectiveCwd = ctx?.cwd || cwd || process.cwd();
	const shellConfig = getShellConfig();
	const env = resolveShellEnv(ctx);
	const commandFromStdin = shellConfig.commandTransport === "stdin";
	const stdinPipe = commandFromStdin || stdin !== undefined;
	let executionCommand = command;
	let isRtk = false;

	if (allowRtk) {
		isRtk = Boolean((params as any)._rtk);
		if (!verbatim && !isRtk && !command.startsWith("rtk ")) {
			const rewritten = await rewriteCommand(command, { signal });
			if (rewritten && rewritten !== command) {
				executionCommand = rewritten;
				isRtk = true;
			}
		}
	}

	return {
		command,
		cwd: effectiveCwd,
		isRtk,
		start() {
			const child = spawn(
				shellConfig.shell,
				commandFromStdin ? shellConfig.args : [...shellConfig.args, executionCommand],
				{
					cwd: effectiveCwd,
					detached: process.platform !== "win32",
					env,
					stdio: [stdinPipe ? "pipe" : "ignore", "pipe", "pipe"],
					windowsHide: true,
				},
			);
			if (commandFromStdin) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(executionCommand);
			} else if (stdin !== undefined) {
				child.stdin?.on("error", () => {});
				child.stdin?.end(stdin);
			}
			return child;
		},
	};
}

function renderBashCall(args: any, theme: any, context: any, defaultBashDef: any) {
	const displayCmd = args?._rawCommand || args?.command || "...";
	if (args?.run_in_background) {
		return new Text(theme.fg("toolTitle", theme.bold(`$ ${displayCmd}`)) + theme.fg("muted", " (background)"), 0, 0);
	}
	return defaultBashDef.renderCall?.(args, theme, context) ?? new Text(`$ ${displayCmd}`, 0, 0);
}

function renderBashResult(result: any, options: any, theme: any, context: any, defaultBashDef: any) {
	const details = result.details as any;
	if (details?.backgrounded) {
		return new Text(theme.fg("accent", `⎿ Running in background as ${details.taskId} (PID ${details.pid})`), 0, 0);
	}
	const fallbackText = result.content[0]?.type === "text" ? result.content[0].text : "";
	return defaultBashDef.renderResult?.(result, options, theme, context) ?? new Text(fallbackText, 0, 0);
}

async function executeBashImpl(
	cwd: string,
	params: BashParameters | ExecBashParameters,
	signal: AbortSignal | undefined,
	onUpdate: any,
	ctx: ExtensionContext | undefined,
	taskManager?: TaskManager,
	allowRtk = false,
): Promise<AgentToolResult<any>> {
	const { command, timeout } = params;
	const run_in_background = "run_in_background" in params ? Boolean(params.run_in_background) : false;
	const prepared = await prepareShellCommand(cwd, params, signal, ctx, allowRtk);
	const { cwd: effectiveCwd, isRtk } = prepared;

	if (run_in_background) {
		if (!taskManager) {
			throw new Error("Background command execution requires a task manager");
		}
		const child = prepared.start();
		const task = taskManager.createTask(command, effectiveCwd, child);

		return {
			content: [
				{
					type: "text",
					text:
						`Command started in background as ${task.id} (PID ${task.pid}).\n` +
						`You can check its progress with \`task\` (action: "status", task_id: "${task.id}") or list tasks with \`task\` (action: "list"). A notification will be sent when the command finishes.`,
				},
			],
			details: {
				taskId: task.id,
				pid: task.pid,
				status: "running",
				backgrounded: true,
				rtk: isRtk,
			},
		};
	}

	const child = prepared.start();
	const output = new OutputBuffer({ tempFilePrefix: "pi-bash" });
	let acceptingOutput = true;
	let updateTimer: NodeJS.Timeout | undefined;
	let updateDirty = false;
	let lastUpdateAt = 0;

	const emitOutputUpdate = () => {
		if (!onUpdate || !updateDirty) return;
		updateDirty = false;
		lastUpdateAt = Date.now();
		const snapshot = output.getSnapshot();
		onUpdate({
			content: [{ type: "text", text: snapshot.content || "" }],
			details: {
				truncated: snapshot.truncated,
				fullOutputPath: snapshot.fullOutputPath,
				rtk: isRtk,
				originalCommand: (params as any)._rawCommand || command,
			},
		});
	};

	const clearUpdateTimer = () => {
		if (updateTimer) {
			clearTimeout(updateTimer);
			updateTimer = undefined;
		}
	};

	const scheduleOutputUpdate = () => {
		if (!onUpdate) return;
		updateDirty = true;
		const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
		if (delay <= 0) {
			clearUpdateTimer();
			emitOutputUpdate();
			return;
		}
		updateTimer ??= setTimeout(() => {
			updateTimer = undefined;
			emitOutputUpdate();
		}, delay);
	};

	if (onUpdate) {
		onUpdate({ content: [], details: undefined });
	}

	const handleData = (chunk: Buffer) => {
		if (!acceptingOutput) return;
		output.append(chunk);
		scheduleOutputUpdate();
	};

	child.stdout?.on("data", handleData);
	child.stderr?.on("data", handleData);

	let backgroundedTask: BackgroundTask | undefined;
	let detachedTask: BackgroundTask | undefined;
	let resolveDetach: (() => void) | undefined;
	const detachPromise = new Promise<void>((res) => {
		resolveDetach = res;
	});

	// Intercept Ctrl+B to background the running command
	const unsubscribeInput =
		taskManager && ctx?.ui?.onTerminalInput
			? ctx.ui.onTerminalInput((data) => {
					if (matchesKey(data, "ctrl+b") || data === "\x02") {
						if (!child.pid || backgroundedTask || detachedTask) return undefined;
						acceptingOutput = false;
						clearUpdateTimer();
						child.unref();
						const currentSnapshot = output.getSnapshot();
						detachedTask = taskManager.createTask(command, effectiveCwd, child, {
							detachedByOperator: true,
							initialText: currentSnapshot.content,
						});
						backgroundedTask = detachedTask;
						ctx.ui?.notify?.(`Backgrounded command (${detachedTask.id})`, "info");
						resolveDetach?.();
						return { consume: true };
					}
					return undefined;
				})
			: undefined;

	try {
		let timedOut = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		if (timeout && timeout > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				if (child.pid) killProcessTree(child.pid);
			}, timeout * 1000);
		}

		const onAbort = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		const processResult = await Promise.race([
			new Promise<{ exitCode: number | null }>((resolve, reject) => {
				let code: number | null = null;
				child.once("error", reject);
				child.once("exit", (c) => {
					code = c;
				});
				child.once("close", (c) => {
					resolve({ exitCode: c ?? code });
				});
			}),
			detachPromise.then(() => ({ detached: true })),
		]);

		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
		if (signal) {
			signal.removeEventListener("abort", onAbort);
		}

		if ("detached" in processResult && processResult.detached && detachedTask) {
			const snapshot = detachedTask.output.getSnapshot();
			return {
				content: [
					{
						type: "text",
						text:
							`[Command backgrounded by operator (Ctrl+B) as ${detachedTask.id} (PID ${detachedTask.pid})]\n` +
							`Partial output so far:\n${snapshot.content || "(no output yet)"}\n\n` +
							`The command continues running in the background. You will receive a notification when it completes, or you can manage it with the task tool.`,
					},
				],
				details: {
					taskId: detachedTask.id,
					pid: detachedTask.pid,
					status: "running",
					backgrounded: true,
				},
			};
		}

		acceptingOutput = false;
		output.finish();
		clearUpdateTimer();

		const snapshot = output.getSnapshot();
		let outputText = snapshot.content || "(no output)";

		if (snapshot.truncated && snapshot.fullOutputPath) {
			outputText += `\n\n[Truncated (${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines limit). Full output: ${snapshot.fullOutputPath}]`;
		}

		if (signal?.aborted) {
			throw new Error(`${outputText ? `${outputText}\n\n` : ""}Command aborted`);
		}

		if (timedOut) {
			throw new Error(`${outputText ? `${outputText}\n\n` : ""}Command timed out after ${timeout} seconds`);
		}

		const exitCode = (processResult as { exitCode: number | null }).exitCode;
		if (exitCode !== 0 && exitCode !== null) {
			throw new Error(`${outputText ? `${outputText}\n\n` : ""}Command exited with code ${exitCode}`);
		}

		return {
			content: [{ type: "text", text: outputText }],
			details: {
				truncated: snapshot.truncated,
				fullOutputPath: snapshot.fullOutputPath,
				rtk: isRtk,
				originalCommand: (params as any)._rawCommand || command,
			},
		};
	} finally {
		unsubscribeInput?.();
		clearUpdateTimer();
	}
}

export function createBashToolDefinition(
	cwd: string = process.cwd(),
	taskManager?: TaskManager,
): ToolDefinition<typeof bashParameters, any, any> {
	const defaultBashDef = createDefaultBashToolDefinition(cwd);

	return {
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB. If truncated, full output is saved to a temp file. Supports standard input via stdin, background execution via run_in_background: true, or interactive detachment with Ctrl+B.",
		promptSnippet: "Execute bash commands (ls, grep, find, etc.). Supports background execution and standard input.",
		promptGuidelines: [
			"You can inspect PI_* environment variables for current model and session details.",
			"Use bash with run_in_background: true for immediate commands that may run while you continue and should wake you only when they complete or fail.",
			"While a foreground command is executing, the operator can press Ctrl+B to background it.",
			"Pass text to standard input using stdin to pipe data into commands without shell escaping issues.",
			"Pass verbatim: true to run commands without RTK output compression when exact raw output is required.",
		],
		parameters: bashParameters,
		async execute(_toolCallId, params: BashParameters, signal, onUpdate, ctx) {
			return executeBashImpl(cwd, params, signal, onUpdate, ctx, taskManager, true);
		},
		renderCall(args, theme, context) {
			return renderBashCall(args, theme, context, defaultBashDef);
		},
		renderResult(result, options, theme, context) {
			return renderBashResult(result, options, theme, context, defaultBashDef);
		},
	};
}

export function createExecBashToolDefinition(
	cwd: string = process.cwd(),
): ToolDefinition<typeof execBashParameters, any, any> {
	const defaultBashDef = createDefaultBashToolDefinition(cwd);

	return {
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB. If truncated, full output is saved to a temp file. Supports standard input via stdin.",
		promptSnippet: "Execute bash commands (ls, grep, find, etc.). Supports standard input.",
		promptGuidelines: [
			"You can inspect PI_* environment variables for current model and session details.",
			"Pass text to standard input using stdin to pipe data into commands without shell escaping issues.",
		],
		parameters: execBashParameters,
		async execute(_toolCallId, params: ExecBashParameters, signal, onUpdate, ctx) {
			return executeBashImpl(cwd, params, signal, onUpdate, ctx, undefined, false);
		},
		renderCall(args, theme, context) {
			return renderBashCall(args, theme, context, defaultBashDef);
		},
		renderResult(result, options, theme, context) {
			return renderBashResult(result, options, theme, context, defaultBashDef);
		},
	};
}

export function createBackgroundTaskBashTool(
	taskManager: TaskManager,
): ToolDefinition<typeof bashParameters, any, any> {
	return createBashToolDefinition(process.cwd(), taskManager);
}
