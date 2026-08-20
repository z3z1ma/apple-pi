/**
 * Native macOS completion notifications for Pi.
 *
 * - Fires on agent_settled, after retries, compaction, and queued follow-ups.
 * - Fires when ask_user_question starts, so an away operator learns Pi is
 *   waiting on their input rather than still working.
 * - Shows tmux coordinates, the latest user prompt, and the final outcome.
 * - Clicking the notification activates Ghostty and selects the original pane.
 * - Run /notify-setup once for a dedicated sender app and icon.
 * - Run /notify-test after /reload to verify delivery and click-to-focus.
 *
 * Optional environment variables:
 * PI_NOTIFY_DISABLED=1, PI_NOTIFY_SOUND, PI_NOTIFY_APP,
 * PI_NOTIFY_FOCUS_SCRIPT, PI_NOTIFY_LOG_PATH, PI_NOTIFY_DISABLE_LOG=1.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOME = homedir();
const PI_HOME = process.env.PI_CODING_AGENT_DIR || join(HOME, ".pi", "agent");
const NOTIFIER_APP = process.env.PI_NOTIFY_APP || join(HOME, "Applications", "Pi Notifier.app");
const APP_NOTIFIER = join(NOTIFIER_APP, "Contents", "MacOS", "terminal-notifier");
const APP_ICON = join(NOTIFIER_APP, "Contents", "Resources", "Pi.icns");
const BUNDLED_ICON = fileURLToPath(new URL("../assets/pi-notify-1024.png", import.meta.url));
const BUNDLED_FOCUS_SCRIPT = fileURLToPath(new URL("../scripts/focus-tmux.sh", import.meta.url));
const FOCUS_CHECK_SCRIPT = fileURLToPath(new URL("../scripts/focus-check.sh", import.meta.url));
const INSTALL_APP_SCRIPT = fileURLToPath(new URL("../scripts/install-notifier-app.sh", import.meta.url));
const HOMEBREW_NOTIFIER = "/opt/homebrew/bin/terminal-notifier";
const FOCUS_SCRIPT = process.env.PI_NOTIFY_FOCUS_SCRIPT || BUNDLED_FOCUS_SCRIPT;
const LOG_PATH = process.env.PI_NOTIFY_LOG_PATH || join(PI_HOME, "logs", "pi-notify.log");
const ASK_TOOL = "ask_user_question";
const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_ICON = "/Applications/Ghostty.app/Contents/Resources/Ghostty.icns";
const NOTIFIER_TIMEOUT_MS = 5_000;
const SUBTITLE_MAX_WIDTH = 48;
const THREAD_TITLE_MAX_WIDTH = 48;
const BODY_MAX_LENGTH = 140;
const IMAGE_MARKER_RE = /\[\s*Image\s+#\d+\s*\]/giu;
const CYBER_POLICY_ERROR_RE =
	/\bcyber(?:_|-)?policy\b|flagged for possible cybersecurity risk|trusted access for cyber/iu;
const GENERIC_HEADINGS = new Set([
	"conclusion",
	"summary",
	"result",
	"results",
	"verification",
	"verification result",
	"verification results",
	"done",
	"outcome",
]);

export interface TmuxTarget {
	coordinate: string;
	sessionName: string;
	windowId: string;
	windowIndex: string;
	paneId: string;
	paneIndex: string;
	paneTitle: string;
}

interface NotificationContent {
	title: string;
	subtitle: string;
	body: string;
	group: string;
}

interface NotificationResult extends NotificationContent {
	success: boolean;
	via: string;
}

export function compactText(value: unknown): string {
	return String(value ?? "")
		.replace(/\s+/gu, " ")
		.trim();
}

export function firstNonEmptyLine(value: unknown): string {
	for (const line of String(value ?? "").split(/\r?\n/u)) {
		const text = compactText(line);
		if (text) return text;
	}
	return "";
}

function isZeroWidth(char: string): boolean {
	return /[\p{Mark}\p{Format}]/u.test(char);
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		codePoint >= 0x1100 &&
		(codePoint <= 0x115f ||
			codePoint === 0x2329 ||
			codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd))
	);
}

export function displayWidth(value: unknown): number {
	let width = 0;
	for (const char of Array.from(String(value ?? ""))) {
		if (isZeroWidth(char)) continue;
		const codePoint = char.codePointAt(0) ?? 0;
		width += isWideCodePoint(codePoint) ? 2 : 1;
	}
	return width;
}

export function shortDisplayText(value: unknown, limit: number): string {
	const text = compactText(value);
	if (!text || limit <= 0) return "";
	if (displayWidth(text) <= limit) return text;

	const suffix = "...";
	const budget = Math.max(0, limit - displayWidth(suffix));
	const result: string[] = [];
	let width = 0;
	for (const char of Array.from(text)) {
		const charWidth = displayWidth(char);
		if (width + charWidth > budget) break;
		result.push(char);
		width += charWidth;
	}
	return result.join("") + suffix;
}

export function notificationSubtitle(value: unknown): string {
	const original = compactText(value);
	const hadImage = IMAGE_MARKER_RE.test(original);
	IMAGE_MARKER_RE.lastIndex = 0;
	let text = compactText(original.replace(IMAGE_MARKER_RE, ""));
	IMAGE_MARKER_RE.lastIndex = 0;
	if (!text && hadImage) text = "Image request";
	return shortDisplayText(text, SUBTITLE_MAX_WIDTH);
}

export function plainNotificationText(value: unknown): string {
	return compactText(
		String(value ?? "")
			.replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
			.replace(/^\s{0,3}#{1,6}\s*/u, "")
			.replace(/^\s*[-*+]\s+/u, "")
			.replace(/`/gu, "")
			.replace(/\*\*|__/gu, ""),
	);
}

export function notificationSummary(value: unknown): string {
	const lines = String(value ?? "")
		.split(/\r?\n/u)
		.map(plainNotificationText)
		.filter(Boolean);
	while (lines.length > 1 && GENERIC_HEADINGS.has(lines[0].toLowerCase())) lines.shift();
	const first = lines[0] || "The task has completed.";
	return first.length <= BODY_MAX_LENGTH ? first : `${first.slice(0, BODY_MAX_LENGTH - 3)}...`;
}

export function askQuestionSummary(args: unknown): string {
	const fallback = "Pi needs your input.";
	const questions = (args as { questions?: unknown } | null | undefined)?.questions;
	if (!Array.isArray(questions) || questions.length === 0) return fallback;
	const first = compactText((questions[0] as { question?: unknown })?.question);
	if (!first) return fallback;
	return questions.length > 1 ? `${first} (+${questions.length - 1} more)` : first;
}

export function notificationErrorSummary(value: unknown): string {
	const error = compactText(value);
	if (CYBER_POLICY_ERROR_RE.test(error)) {
		return "Task blocked by cyber_policy; return to Pi for details.";
	}
	const detail = error.replace(/^(?:Codex error:\s*)/iu, "") || "Unknown error";
	return notificationSummary(`Task failed: ${detail}`);
}

export function extractMessageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } =>
			Boolean(
				block &&
					typeof block === "object" &&
					(block as { type?: unknown }).type === "text" &&
					typeof (block as { text?: unknown }).text === "string",
			),
		)
		.map((block) => block.text)
		.join("\n")
		.trim();
}

export function cleanPaneTitle(value: unknown): string {
	return compactText(value)
		.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/u, "")
		.replace(/^π\s*(?:[-–—|·:]\s*)?/iu, "");
}

export function safeId(value: unknown): string {
	return (
		compactText(value)
			.replace(/[^A-Za-z0-9_.-]/gu, "_")
			.slice(0, 96) || "unknown"
	);
}

export function shellQuote(value: unknown): string {
	return `'${String(value ?? "").replace(/'/gu, `'\\''`)}'`;
}

export function parseTmuxTarget(output: string): TmuxTarget | undefined {
	const parts = output.trimEnd().split("\t");
	if (parts.length < 7) return undefined;
	const [sessionId, sessionName, windowId, windowIndex, paneId, paneIndex, ...title] = parts;
	const numericSession = sessionId.replace(/^\$/u, "");
	const coordinate = [numericSession, windowIndex, paneIndex].every((part) => /^\d+$/u.test(part))
		? `${numericSession}:${windowIndex}:${paneIndex}`
		: "";
	return {
		coordinate,
		sessionName,
		windowId,
		windowIndex,
		paneId,
		paneIndex,
		paneTitle: title.join("\t"),
	};
}

export function tmuxSocketFromEnv(): string {
	// $TMUX is "<socket>,<pid>,<session>" inside a tmux client; the socket is the
	// portion before the first comma.
	return (process.env.TMUX || "").split(",")[0] || "";
}

export function buildFocusCommand(target: TmuxTarget | undefined, tmuxBin?: string, tmuxSocket?: string): string {
	if (!target?.paneId) return "";
	// The click runs in a minimal launchd context with no $TMUX or interactive
	// $PATH, so bake the absolute tmux binary and server socket into the stored
	// command. terminal-notifier persists this exact string and runs it later.
	const env = ["/usr/bin/env"];
	if (tmuxBin) env.push(`TMUX_BIN=${tmuxBin}`);
	if (tmuxSocket) env.push(`TMUX_SOCKET=${tmuxSocket}`);
	return [...env, "bash", FOCUS_SCRIPT, target.sessionName, target.windowId, target.paneId, target.windowIndex]
		.map(shellQuote)
		.join(" ");
}

export function buildNotifierArgs(content: NotificationContent, iconPath: string, focusCommand: string): string[] {
	const args = [
		"-title",
		content.title,
		"-subtitle",
		content.subtitle,
		"-message",
		content.body,
		"-sound",
		process.env.PI_NOTIFY_SOUND || "Glass",
		"-group",
		content.group,
	];
	if (iconPath) args.push("-appIcon", pathToFileURL(iconPath).href);
	if (focusCommand) args.push("-execute", focusCommand);
	return args;
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		await access(path, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

// Resolve an absolute tmux path. The focus script runs in a launchd context
// with a minimal PATH that may exclude the real install (e.g. nix-darwin at
// /run/current-system/sw/bin), so the extension must resolve the absolute path
// here and bake it into the click command.
//
// Resolve via the PATH first: the tmux client must match the running server's
// protocol version, and the server was started by whatever tmux is on the
// user's PATH — the same environment Pi inherits. A shell PATH lookup returns
// that binary. The hardcoded candidates are only a last resort when no tmux is
// on PATH, and could otherwise bake in a mismatched build (e.g. a Homebrew
// tmux against a nix-started server), so they must not win over the PATH.
async function resolveTmuxBin(pi: ExtensionAPI): Promise<string> {
	try {
		const result = await pi.exec("/bin/sh", ["-c", "command -v tmux"], {
			timeout: 2_000,
		});
		const resolved = result.stdout.trim();
		if (result.code === 0 && resolved) return resolved;
	} catch {
		// Fall through to the fixed candidates below.
	}
	const candidates = [
		"/opt/homebrew/bin/tmux",
		"/run/current-system/sw/bin/tmux",
		`${HOME}/.nix-profile/bin/tmux`,
		"/usr/local/bin/tmux",
	];
	for (const candidate of candidates) {
		if (await isExecutable(candidate)) return candidate;
	}
	return "tmux";
}

async function readTmuxTarget(pi: ExtensionAPI, tmuxBin: string): Promise<TmuxTarget | undefined> {
	const pane = process.env.TMUX_PANE;
	if (!pane) return undefined;
	const result = await pi.exec(
		tmuxBin,
		[
			"display-message",
			"-p",
			"-t",
			pane,
			"#{session_id}\t#{session_name}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_index}\t#{pane_title}",
		],
		{ timeout: 2_000 },
	);
	return result.code === 0 ? parseTmuxTarget(result.stdout) : undefined;
}

// Report whether the operator is already looking at the Pi pane: Ghostty is
// frontmost and the pane's tmux window is the active window of an attached
// session. Delegated to focus-check.sh so the platform detection stays with the
// other bash focus logic. Fails open — any error or inconclusive result returns
// false so a real notification is never suppressed by a detection failure.
async function isOperatorViewingPane(
	pi: ExtensionAPI,
	tmuxBin: string,
	tmuxSocket: string,
	target: TmuxTarget | undefined,
): Promise<boolean> {
	if (!target?.paneId && !target?.windowId) return false;
	const env = ["/usr/bin/env"];
	if (tmuxBin) env.push(`TMUX_BIN=${tmuxBin}`);
	if (tmuxSocket) env.push(`TMUX_SOCKET=${tmuxSocket}`);
	try {
		const result = await pi.exec(
			env[0],
			[...env.slice(1), "bash", FOCUS_CHECK_SCRIPT, target.paneId || "", target.windowId || ""],
			{ timeout: NOTIFIER_TIMEOUT_MS },
		);
		return result.code === 0;
	} catch {
		return false;
	}
}

async function projectTitle(pi: ExtensionAPI, cwd: string): Promise<string> {
	try {
		const result = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 2_000 });
		if (result.code === 0 && result.stdout.trim()) return basename(result.stdout.trim());
	} catch {
		// Fall back to cwd below.
	}
	return basename(cwd) || "Pi";
}

function latestBranchText(ctx: ExtensionContext, role: "user" | "assistant"): string {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index] as {
			type?: string;
			message?: { role?: string };
		};
		if (entry.type !== "message" || entry.message?.role !== role) continue;
		const text = extractMessageText(entry.message);
		if (text) return text;
	}
	return "";
}

async function appendLog(record: Record<string, unknown>): Promise<void> {
	if (/^(?:1|true|yes)$/iu.test(process.env.PI_NOTIFY_DISABLE_LOG || "")) return;
	try {
		await mkdir(dirname(LOG_PATH), { recursive: true });
		await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
	} catch {
		// Notifications must never fail because logging failed.
	}
}

async function runAppleScript(
	pi: ExtensionAPI,
	title: string,
	subtitle: string,
	body: string,
	targetGhostty: boolean,
): Promise<boolean> {
	const tellStart = targetGhostty ? `tell application id "${GHOSTTY_BUNDLE_ID}"\n` : "";
	const tellEnd = targetGhostty ? "\nend tell" : "";
	const script = `on run argv
set notificationBody to item 1 of argv
set notificationTitle to item 2 of argv
set notificationSubtitle to item 3 of argv
${tellStart}display notification notificationBody with title notificationTitle subtitle notificationSubtitle${tellEnd}
end run`;
	try {
		const result = await pi.exec("/usr/bin/osascript", ["-e", script, body, title, subtitle], {
			timeout: NOTIFIER_TIMEOUT_MS,
		});
		return result.code === 0;
	} catch {
		return false;
	}
}

async function deliverNotification(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	prompt: string,
	answer: string,
	subtitleFallback = "Task complete",
	skipIfFocused = false,
): Promise<NotificationResult> {
	const tmuxBin = await resolveTmuxBin(pi);
	const [target, project] = await Promise.all([readTmuxTarget(pi, tmuxBin), projectTitle(pi, ctx.cwd)]);
	const tmuxSocket = tmuxSocketFromEnv();
	const threadTitle = shortDisplayText(
		pi.getSessionName() || cleanPaneTitle(target?.paneTitle) || project,
		THREAD_TITLE_MAX_WIDTH,
	);
	const title = target?.coordinate ? `${target.coordinate} · ${threadTitle || project}` : threadTitle || project;
	const subtitle = notificationSubtitle(firstNonEmptyLine(prompt)) || subtitleFallback;
	const body = notificationSummary(answer);
	const sessionId = ctx.sessionManager.getSessionId();
	const group = `pi-agent-turn-complete-${safeId(sessionId || target?.paneId || project)}`;
	const content: NotificationContent = { title, subtitle, body, group };

	// Suppress redundant automatic notifications when the operator is already
	// viewing the pane. Skipped for /notify-test, which must always deliver.
	if (skipIfFocused && (await isOperatorViewingPane(pi, tmuxBin, tmuxSocket, target))) {
		await appendLog({
			ts: new Date().toISOString(),
			success: false,
			via: "skipped-focused",
			sessionId,
			tmuxPane: target?.paneId || "",
			coordinate: target?.coordinate || "",
		});
		return { ...content, success: false, via: "skipped-focused" };
	}

	const focusCommand = buildFocusCommand(target, tmuxBin, tmuxSocket);
	const iconPath = (await isFile(APP_ICON))
		? APP_ICON
		: (await isFile(BUNDLED_ICON))
			? BUNDLED_ICON
			: (await isFile(GHOSTTY_ICON))
				? GHOSTTY_ICON
				: "";

	let success = false;
	let via = "none";
	const candidates = [APP_NOTIFIER, HOMEBREW_NOTIFIER];
	for (const notifier of candidates) {
		if (!(await isExecutable(notifier))) continue;
		try {
			const result = await pi.exec(notifier, buildNotifierArgs(content, iconPath, focusCommand), {
				timeout: NOTIFIER_TIMEOUT_MS,
			});
			if (result.code === 0) {
				success = true;
				via = notifier === APP_NOTIFIER ? "pi-app" : "terminal-notifier";
				break;
			}
		} catch {
			// Try the next delivery path.
		}
	}

	if (!success && (await runAppleScript(pi, title, subtitle, body, true))) {
		success = true;
		via = "ghostty-osascript";
	}
	if (!success && (await runAppleScript(pi, title, subtitle, body, false))) {
		success = true;
		via = "osascript";
	}

	await appendLog({
		ts: new Date().toISOString(),
		success,
		via,
		sessionId,
		tmuxPane: target?.paneId || "",
		coordinate: target?.coordinate || "",
	});
	return { ...content, success, via };
}

function notificationsDisabled(): boolean {
	return /^(?:1|true|yes)$/iu.test(process.env.PI_NOTIFY_DISABLED || "");
}

export default function piNotifyExtension(pi: ExtensionAPI): void {
	let pendingRawPrompt: string | undefined;
	let latestPrompt = "";
	let latestAssistant = "";
	let latestError: string | undefined;
	let latestAborted = false;
	let lastNotifiedKey = "";

	pi.on("input", (event) => {
		pendingRawPrompt = event.text;
		latestPrompt = event.text;
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event) => {
		latestPrompt = pendingRawPrompt ?? event.prompt;
		pendingRawPrompt = undefined;
		latestAssistant = "";
		latestError = undefined;
		latestAborted = false;
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		if (event.message.stopReason === "error") {
			latestError = compactText(event.message.errorMessage);
			latestAborted = false;
			return;
		}
		if (event.message.stopReason === "aborted") {
			latestError = undefined;
			latestAborted = true;
			return;
		}
		latestError = undefined;
		latestAborted = false;
		const text = extractMessageText(event.message);
		if (text) latestAssistant = text;
	});

	pi.on("tool_execution_start", (event, ctx) => {
		// The ask tool blocks the turn waiting on the operator, so agent_settled
		// never fires while it is pending. Notify here that Pi needs input; do not
		// gate on ctx.isIdle(), which is false mid-turn.
		if (event.toolName !== ASK_TOOL) return;
		if (process.platform !== "darwin" || notificationsDisabled() || ctx.mode !== "tui") return;
		const prompt = latestPrompt || latestBranchText(ctx, "user");
		// This event blocks the tool pipeline until the handler resolves, so deliver
		// without awaiting; otherwise notifier timeouts would delay the dialog.
		void deliverNotification(pi, ctx, prompt, askQuestionSummary(event.args), "Pi needs your input", true).catch(
			() => {},
		);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (process.platform !== "darwin" || notificationsDisabled() || ctx.mode !== "tui" || !ctx.isIdle()) return;

		const sessionId = ctx.sessionManager.getSessionId();
		const leafId = ctx.sessionManager.getLeafId() || "";
		const notificationKey = `${sessionId}:${leafId}`;
		if (notificationKey === lastNotifiedKey) return;
		lastNotifiedKey = notificationKey;

		const prompt = latestPrompt || latestBranchText(ctx, "user");
		const answer =
			latestError !== undefined
				? notificationErrorSummary(latestError)
				: latestAborted
					? "Task cancelled."
					: latestAssistant || latestBranchText(ctx, "assistant");
		await deliverNotification(pi, ctx, prompt, answer, "Task complete", true);
	});

	pi.registerCommand("notify-setup", {
		description: "Install the dedicated macOS Pi Notifier app",
		handler: async (args, ctx) => {
			if (args.trim() !== "") {
				ctx.ui.notify("Usage: /notify-setup", "error");
				return;
			}
			if (process.platform !== "darwin") {
				ctx.ui.notify("Pi Notifier setup currently supports macOS only", "error");
				return;
			}
			try {
				const result = await pi.exec("/usr/bin/env", ["bash", INSTALL_APP_SCRIPT], { timeout: 30_000 });
				if (result.code !== 0) {
					const detail = firstNonEmptyLine(result.stderr) || `exit code ${result.code}`;
					ctx.ui.notify(`Pi Notifier setup failed: ${detail}`, "error");
					return;
				}
				ctx.ui.notify("Pi Notifier app installed. Run /notify-test.", "info");
			} catch (error) {
				ctx.ui.notify(`Pi Notifier setup failed: ${String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("notify-test", {
		description: "Send a Pi desktop notification and test tmux click-to-focus",
		handler: async (_args, ctx) => {
			if (notificationsDisabled()) {
				ctx.ui.notify("Pi desktop notifications are disabled by PI_NOTIFY_DISABLED", "warning");
				return;
			}
			const result = await deliverNotification(
				pi,
				ctx,
				"Pi notification test",
				"Notifications are enabled; clicking this should return to the current Ghostty/tmux pane.",
			);
			ctx.ui.notify(
				result.success
					? `Desktop notification sent via ${result.via}`
					: "Desktop notification failed; check ~/.pi/agent/logs/pi-notify.log",
				result.success ? "info" : "error",
			);
		},
	});
}
