import { InlineCodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import type { RuleEvent } from "./events.js";

export interface ScriptSource {
	id: string;
	on: RuleEvent["on"];
	body: string;
}

export type ScriptOutcome = { reasons: string[] } | { error: string };

const PRELUDE = `const matches = (path, glob) => {
	if (typeof path !== "string" || typeof glob !== "string") return false;
	let pattern = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === "*" && glob[index + 1] === "*") {
			pattern += glob[index + 2] === "/" ? "(?:.*/)?" : ".*";
			index += glob[index + 2] === "/" ? 2 : 1;
		} else if (char === "*") pattern += "[^/]*";
		else if (char === "?") pattern += "[^/]";
		else pattern += char.replace(/[.+^\${}()|[\\]\\\\]/g, "\\\\$&");
	}
	return new RegExp("^" + pattern + "$").test(path);
};
const reasonsOf = (value) => (value === true ? [true] : value ? (Array.isArray(value) ? value : [value]) : []).map((each) => (each === true ? true : String(each)));
`;

let wasm: ReturnType<typeof loadQuickJSWasm> | undefined;

function program(rules: ScriptSource[], events: RuleEvent[]): string {
	const functions = rules.map((rule) => `${JSON.stringify(rule.id)}: (event) => {\n${rule.body}\n}`).join(",\n");
	return `${PRELUDE}
const rules = {
${functions}
};
const on = ${JSON.stringify(Object.fromEntries(rules.map((rule) => [rule.id, rule.on])))};
const events = ${JSON.stringify(events)};
return events.map((event) => {
	const row = {};
	for (const id of Object.keys(rules)) {
		if (on[id] !== event.on) continue;
		try {
			row[id] = { reasons: reasonsOf(rules[id](event)) };
		} catch (error) {
			row[id] = { error: String((error && error.message) || error) };
		}
	}
	return row;
});`;
}

async function execute(rules: ScriptSource[], events: RuleEvent[]): Promise<Record<string, ScriptOutcome>[] | string> {
	wasm ??= loadQuickJSWasm();
	const sandbox = new InlineCodemodeSandbox({ tools: [], wasm, timeoutMs: Number.POSITIVE_INFINITY });
	try {
		const result = await sandbox.execute(program(rules, events));
		if (!result.ok) return result.error.message;
		return result.value as Record<string, ScriptOutcome>[];
	} finally {
		await sandbox.close();
	}
}

export async function runScripts(
	rules: ScriptSource[],
	events: RuleEvent[],
	messages: Map<string, string | undefined> = new Map(),
): Promise<Record<string, ScriptOutcome>[]> {
	if (!rules.length || !events.length) return events.map(() => ({}));
	let rows = await execute(rules, events);
	if (typeof rows === "string") {
		const separate = await Promise.all(rules.map(async (rule) => [rule, await execute([rule], events)] as const));
		rows = events.map((_, index) =>
			Object.fromEntries(
				separate.flatMap(([rule, result]) =>
					typeof result === "string"
						? events[index]!.on === rule.on
							? [[rule.id, { error: result }]]
							: []
						: Object.entries(result[index]!),
				),
			),
		);
	}
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([id, outcome]) => {
				if ("error" in outcome) return [id, outcome];
				const message = messages.get(id);
				const reasons = (outcome.reasons as unknown[]).flatMap((reason) =>
					reason === true ? (message ? [message] : ["refused"]) : [String(reason)],
				);
				return [id, { reasons }];
			}),
		),
	);
}
