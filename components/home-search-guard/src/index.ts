import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PI_SEARCH_TOOLS = new Set(["grep", "find", "glob"]);
const BRACED_HOME = "$" + "{HOME}";
const BASH_SEARCH_COMMAND =
	/(?:^|[;&|(\n]\s*)(?:(?:[A-Za-z_]\w*=\S+|sudo|command|env|time|nice|nohup|-[^\s;&|()]+)\s+)*(?:[^\s;&|()]+\/)?(?:rg|ripgrep|grep|egrep|fgrep|find|fd|fdfind)\b/m;

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function expandHome(value: string, home: string): string {
	const path = value.startsWith("@") ? value.slice(1) : value;
	if (path === "~" || path === "$HOME" || path === BRACED_HOME) return home;
	if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
	if (path.startsWith("$HOME/")) return `${home}/${path.slice(6)}`;
	if (path.startsWith(`${BRACED_HOME}/`)) return `${home}/${path.slice(BRACED_HOME.length + 1)}`;
	return path;
}

function isHomeRoot(value: string, cwd: string, home: string): boolean {
	return resolve(cwd, expandHome(value, home)) === resolve(home);
}

function shellWords(command: string): string[] {
	return (command.match(/"(?:\\.|[^"])*"|'[^']*'|[^\s;&|()]+/g) ?? []).map((token) => {
		if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
			return token.slice(1, -1);
		}
		return token;
	});
}

function piSearchRoot(toolName: string, input: Record<string, unknown>, cwd: string): string {
	if (toolName === "glob") {
		for (const field of ["root", "cwd", "directory", "base"]) {
			if (typeof input[field] === "string") return input[field];
		}
		return cwd;
	}
	return typeof input.path === "string" ? input.path : cwd;
}

export function homeSearchBlockReason(
	toolName: string,
	rawInput: unknown,
	cwd: string,
	home = homedir(),
): string | undefined {
	const input = asRecord(rawInput);
	let searchesHome = false;

	if (PI_SEARCH_TOOLS.has(toolName)) {
		searchesHome = isHomeRoot(piSearchRoot(toolName, input, cwd), cwd, home);
	} else if (toolName === "bash" && typeof input.command === "string" && BASH_SEARCH_COMMAND.test(input.command)) {
		searchesHome = isHomeRoot(cwd, cwd, home) || shellWords(input.command).some((word) => isHomeRoot(word, cwd, home));
	}

	if (!searchesHome) return undefined;
	return `Blocked ${toolName}: refusing to search from home directory ${resolve(home)}. Use a narrower search root.`;
}

export function installHomeSearchGuard(pi: ExtensionAPI, home = homedir()): void {
	pi.on("tool_call", (event, ctx) => {
		const reason = homeSearchBlockReason(event.toolName, event.input, ctx.cwd, home);
		return reason ? { block: true, reason } : undefined;
	});
}

export default installHomeSearchGuard;
