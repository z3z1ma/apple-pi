import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { Reply } from "../../../tests/helpers/faux-session.js";

/** A complete configuration; tests change the keys they exercise. */
export function validConfig(): Record<string, unknown> {
	return {
		passive: { enabled: false, repeatThreshold: 3 },
		enumerate: { count: 4 },
		branches: { perGeneration: 2, maxTotal: 6 },
		generations: { maxDepth: 0, rootsPerGeneration: 0, parentsPerGeneration: 1, childrenPerParent: 1 },
		branch: { limits: { wallClockSec: 600 } },
		scorer: { validationRetries: 1 },
		constraints: ["Add no new dependencies."],
		workspace: { cloneIgnored: ["node_modules"] },
		apply: "report",
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

export type Behavior = (Reply | "until-aborted")[];

export function text(message: Context["messages"][number] | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

export function write(path: string, content: string, id: string): Reply {
	return fauxAssistantMessage(fauxToolCall("write", { path, content }, { id }), { stopReason: "toolUse" });
}

export function finish(result: "done" | "abandoned", learned: string): Reply {
	return fauxAssistantMessage(`Finished.\nresult: ${result}\nlearned: ${learned}`);
}

export function withOutput(reply: Reply, output: number): Reply {
	return { ...reply, usage: { ...reply.usage, output } };
}

export const FIX = write("app.ts", "export const value = 2;\n", "fix");
export const WRONG = write("app.ts", "export const value = 3;\n", "wrong");

/**
 * The scripted model: the enumerator prompt gets the candidate list; each branch replies by its
 * approach, one scripted reply per model turn after its directive.
 */
export function scriptedModel(
	behaviors: Record<string, Behavior>,
	enumerator?: () => Reply | "until-aborted",
	author: Reply[] = [],
	/** Answers any other request first, such as the parent's own turns or a review; undefined passes. */
	other?: (context: Context) => Reply | "until-aborted" | undefined,
) {
	const candidates = Object.keys(behaviors).map((id) => ({
		id,
		approach: `approach ${id}`,
		firstStep: `open app.ts for ${id}`,
	}));
	return (context: Context): Reply | "until-aborted" => {
		const answer = other?.(context);
		if (answer !== undefined) return answer;
		if (context.messages.some((message) => text(message).includes("Branch search: acceptance checks.")))
			return author.shift() ?? fauxAssistantMessage("No more scripted author replies.");
		if (text(context.messages.at(-1)).includes("Branch search: approach list."))
			return enumerator?.() ?? fauxAssistantMessage(JSON.stringify({ candidates, preferred: "c1" }));
		const directive = context.messages.findLastIndex((message) => text(message).includes("Branch search: attempt"));
		if (directive < 0) return fauxAssistantMessage("Understood.");
		const approach = /Approach: approach (\S+)/.exec(text(context.messages[directive]))?.[1] as string;
		const turn = context.messages.slice(directive + 1).filter((message) => message.role === "assistant").length;
		return behaviors[approach]?.[turn] ?? fauxAssistantMessage("result: done\nlearned: nothing more to do");
	};
}

/** The search fixture: a check that passes once `app.ts` holds value 2, and an ignored dependency directory. */
export function initFixtureRepo(cwd: string): void {
	initRepo(cwd, {
		".gitignore": "agent/\nnode_modules/\n",
		"check.sh": "grep -q 'value = 2' app.ts\n",
		"src/keep.txt": "keep\n",
	});
	mkdirSync(join(cwd, "node_modules"));
	writeFileSync(join(cwd, "node_modules", "dep.js"), "dep\n");
}

export function candidateList(ids: string[], preferred = ids[0]): Reply {
	const candidates = ids.map((id) => ({ id, approach: `approach ${id}`, firstStep: `open app.ts for ${id}` }));
	return fauxAssistantMessage(JSON.stringify({ candidates, preferred }));
}

const PEEK = fauxAssistantMessage(fauxToolCall("bash", { command: "cat app.ts; ls", verbatim: true }, { id: "peek" }), {
	stopReason: "toolUse",
});

/**
 * The enumerator of a dead branch: a request whose approach-list prompt follows an attempt's
 * conversation. It looks at its worktree once, then lists the child approaches.
 */
export function childEnumerator(ids: string[]) {
	return (context: Context): Reply | undefined => {
		const prompt = context.messages.findLastIndex((m) => text(m).includes("Branch search: approach list."));
		if (prompt < 0) return undefined;
		if (!context.messages.slice(0, prompt).some((m) => text(m).startsWith("Branch search: attempt"))) return undefined;
		return context.messages.at(-1)?.role === "toolResult" ? candidateList(ids, ids.at(-1)) : PEEK;
	};
}
