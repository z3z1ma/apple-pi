import { InlineCodemodeSandbox, loadQuickJSWasm } from "@earendil-works/pi-codemode";
import type { RuleEvent } from "./events.js";

export interface ScriptSource {
	id: string;
	on: RuleEvent["on"];
	body: string;
}

export type ScriptOutcome = { reasons: string[] } | { error: string };
type Row = Map<string, ScriptOutcome>;

let wasm: ReturnType<typeof loadQuickJSWasm> | undefined;

function program(rules: ScriptSource[], events: RuleEvent[]): string {
	const functions = rules.map(
		(rule) => `[${JSON.stringify(rule.id)}, ${JSON.stringify(rule.on)}, (event) => {\n${rule.body}\n}]`,
	);
	return `const reasonsOf = (value) => (value === true ? [true] : value ? (Array.isArray(value) ? value : [value]) : []).map((each) => (each === true ? true : String(each)));
const rules = [
${functions.join(",\n")}
];
const events = ${JSON.stringify(events.map((event) => JSON.stringify(event)))};
return events.map((event) => {
	const row = [];
	for (const [id, on, rule] of rules) {
		if (on !== JSON.parse(event).on) continue;
		try {
			row.push([id, { reasons: reasonsOf(rule(JSON.parse(event))) }]);
		} catch (error) {
			row.push([id, { error: String((error && error.message) || error) }]);
		}
	}
	return row;
});`;
}

async function execute(rules: ScriptSource[], events: RuleEvent[]): Promise<Row[] | string> {
	wasm ??= loadQuickJSWasm();
	const sandbox = new InlineCodemodeSandbox({ tools: [], wasm, timeoutMs: Number.POSITIVE_INFINITY });
	try {
		const result = await sandbox.execute(program(rules, events));
		if (!result.ok) return result.error.message;
		return (result.value as [string, ScriptOutcome][][]).map((row) => new Map(row));
	} finally {
		await sandbox.close();
	}
}

export async function runScripts(
	rules: ScriptSource[],
	events: RuleEvent[],
	messages: Map<string, string | undefined> = new Map(),
): Promise<Row[]> {
	if (!rules.length || !events.length) return events.map(() => new Map());
	let rows = await execute(rules, events);
	if (typeof rows === "string") {
		const separate = await Promise.all(rules.map(async (rule) => [rule, await execute([rule], events)] as const));
		rows = events.map(
			(event, index) =>
				new Map(
					separate.flatMap(([rule, result]): [string, ScriptOutcome][] => {
						if (typeof result !== "string") return [...result[index]!];
						return event.on === rule.on ? [[rule.id, { error: result }]] : [];
					}),
				),
		);
	}
	return rows.map(
		(row) =>
			new Map(
				[...row].map(([id, outcome]): [string, ScriptOutcome] => {
					if ("error" in outcome) return [id, outcome];
					const message = messages.get(id);
					const reasons = (outcome.reasons as unknown[]).flatMap((reason) =>
						reason === true ? [message ?? "refused"] : [String(reason)],
					);
					return [id, { reasons }];
				}),
			),
	);
}
