import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { Reply } from "../../../tests/helpers/faux-session.js";

/** A complete configuration; tests change the keys they exercise. */
export function validConfig(): Record<string, unknown> {
	return {
		attempts: 2,
		limits: { wallClockSec: 600 },
		workspace: { cloneIgnored: ["node_modules"] },
	};
}

/** A git repository in `dir` with `files` committed as its first commit. */
export function initRepo(dir: string, files: Record<string, string>): void {
	const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	run("init", "-q", "-b", "main");
	run("config", "user.name", "test");
	run("config", "user.email", "test@localhost");
	run("config", "commit.gpgsign", "false");
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	run("add", "-A");
	run("commit", "-q", "-m", "initial");
}

export function gitOut(dir: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

/** A reply, a held request, or a function called when the request arrives (for a barrier). */
export type Behavior = (Reply | "until-aborted" | (() => Promise<Reply>))[];

/** Entries that each hold their request until all `count` have arrived, then reply. */
export function barrier(count: number, reply: Reply): () => Promise<Reply> {
	let arrived = 0;
	let release: () => void = () => {};
	const all = new Promise<void>((resolve) => {
		release = resolve;
	});
	return () => {
		if (++arrived === count) release();
		return all.then(() => reply);
	};
}

export function text(message: Context["messages"][number] | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

export function write(path: string, content: string, id: string): Reply {
	return fauxAssistantMessage(fauxToolCall("write", { path, content }, { id }), { stopReason: "toolUse" });
}

export const DONE = fauxAssistantMessage("Finished.");

export function withOutput(reply: Reply, output: number): Reply {
	return { ...reply, usage: { ...reply.usage, output } };
}

export const FIX = write("app.ts", "export const value = 2;\n", "fix");
export const WRONG = write("app.ts", "export const value = 3;\n", "wrong");
/** An attempt's judge number: `score.txt`, which the fixture's judge prints. */
export const scoreOf = (value: string, id: string) => write("score.txt", `${value}\n`, id);

/** The fixture's gate and judge. */
export const GATE = "bash check.sh";
export const JUDGE = { command: "cat score.txt", better: "lower" as const };

export function candidateList(ids: string[]): Reply {
	const candidates = ids.map((id) => ({ id, approach: `approach ${id}`, firstStep: `open app.ts for ${id}` }));
	return fauxAssistantMessage(JSON.stringify({ candidates }));
}

/**
 * The scripted model: the enumerator prompt gets the candidate list in `behaviors` order; each
 * attempt replies by its approach, one scripted reply per model turn after its prompt.
 */
export function scriptedModel(
	behaviors: Record<string, Behavior>,
	enumerator?: () => Reply | "until-aborted",
	/** Answers any other request first, such as the parent's own turns; undefined passes. */
	other?: (context: Context) => Reply | "until-aborted" | undefined,
) {
	return (context: Context): Reply | "until-aborted" | Promise<Reply> => {
		const answer = other?.(context);
		if (answer !== undefined) return answer;
		if (text(context.messages.at(-1)).includes("Branch search: approach list."))
			return enumerator?.() ?? candidateList(Object.keys(behaviors));
		const prompt = context.messages.findLastIndex((message) => text(message).includes("Branch search: attempt"));
		if (prompt < 0) return fauxAssistantMessage("Understood.");
		const approach = /Approach: approach (\S+)/.exec(text(context.messages[prompt]))?.[1] as string;
		const turn = context.messages.slice(prompt + 1).filter((message) => message.role === "assistant").length;
		const entry = behaviors[approach]?.[turn] ?? DONE;
		return typeof entry === "function" ? entry() : entry;
	};
}

/** The search fixture: a gate that passes once `app.ts` holds value 2, and an ignored dependency directory. */
export function initFixtureRepo(cwd: string): void {
	initRepo(cwd, {
		".gitignore": "agent/\nnode_modules/\n",
		"check.sh": "grep -q 'value = 2' app.ts\n",
		"src/keep.txt": "keep\n",
	});
	mkdirSync(join(cwd, "node_modules"));
	writeFileSync(join(cwd, "node_modules", "dep.js"), "dep\n");
}
