import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import {
	type CodemodeJsonSchema,
	type CodemodeResult,
	CodemodeSandbox,
	parseCodemodeSource,
} from "@earendil-works/pi-codemode";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROGRAMS_DIRECTORY = ".pi/programs";
const PROGRAM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEADER = /^\s*\/\/\s*@program:(.*)$/m;
const OPTIONS = /^\s*\/\/\s*@options:.*$/m;

type Schema = Record<string, unknown>;

export interface SavedProgram {
	name: string;
	description: string;
	parameters: Record<string, Schema>;
	required: string[];
	body: string;
}

function programsDirectory(cwd: string): string | undefined {
	const directory = join(cwd, PROGRAMS_DIRECTORY);
	if (!existsSync(directory)) return undefined;
	const resolved = realpathSync(directory);
	const fromRoot = relative(realpathSync(cwd), resolved);
	if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
		throw new Error(`${directory}: the programs directory must resolve within the project`);
	return lstatSync(resolved).isDirectory() ? resolved : undefined;
}

export function parseProgram(name: string, source: string): SavedProgram {
	const header = HEADER.exec(source);
	if (!header) throw new Error('a program starts with // @program: {"description": "…", "parameters": {…}}');
	const meta = JSON.parse(header[1]!) as { description?: unknown; parameters?: unknown; required?: unknown };
	if (typeof meta.description !== "string" || !meta.description.trim())
		throw new Error("// @program: needs a description");
	const parameters = (meta.parameters ?? {}) as Record<string, Schema>;
	if (typeof parameters !== "object" || Array.isArray(parameters))
		throw new Error("// @program: parameters maps each name to a JSON Schema");
	const required = Array.isArray(meta.required) ? meta.required.map(String) : [];
	return { name, description: meta.description.trim(), parameters, required, body: source.replace(HEADER, "") };
}

function readProgram(cwd: string, name: string): SavedProgram {
	if (!PROGRAM_NAME.test(name)) throw new Error(`${name}: a program name uses lowercase letters, digits and hyphens`);
	const directory = programsDirectory(cwd);
	const path = directory && join(directory, `${name}.js`);
	if (!path || !existsSync(path) || !lstatSync(path).isFile()) throw new Error(`Unknown program: ${name}`);
	return parseProgram(name, readFileSync(path, "utf8"));
}

function listPrograms(cwd: string): SavedProgram[] {
	const directory = programsDirectory(cwd);
	if (!directory) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			try {
				return [readProgram(cwd, entry.name.slice(0, -3))];
			} catch {
				return [];
			}
		});
}

export function programToolName(name: string): string {
	return `program_${name.replace(/-/g, "_")}`;
}

export function programScript(program: SavedProgram, args: Record<string, unknown>): string {
	const inputs = Object.fromEntries(
		Object.entries(program.parameters).flatMap(([key, schema]) => {
			const value = args[key] ?? schema.default;
			return value === undefined ? [] : [[key, value]];
		}),
	);
	const options = OPTIONS.exec(program.body)?.[0].trim();
	const body = (options ? program.body.replace(OPTIONS, "") : program.body).trim();
	return [options, `const inputs = ${JSON.stringify(inputs)};`, body].filter(Boolean).join("\n");
}

function textOf(content: readonly { type: string; text?: string }[]): string {
	return content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

function valueText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function bounded(text: string, maxOutputTokens: number): Promise<string> {
	if (text.length <= maxOutputTokens * 4) return text;
	const path = join(await mkdtemp(join(tmpdir(), "program-")), "output.txt");
	await writeFile(path, text);
	const half = maxOutputTokens * 2;
	return `${text.slice(0, half)}\n[${text.length - 2 * half} characters omitted; the full output is in ${path}]\n${text.slice(-half)}`;
}

async function runScript(ctx: ExtensionToolContext, source: string, signal?: AbortSignal) {
	const { code, options } = parseCodemodeSource(source);
	const sandbox = new CodemodeSandbox({
		tools: ctx.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as CodemodeJsonSchema,
			async execute(args, call) {
				const outcome = await ctx.executeTool(tool.name, args, { signal: call.signal });
				if (tool.outputSchema && outcome.result.structuredContent !== undefined)
					return outcome.result.structuredContent;
				const text = textOf(outcome.result.content);
				if (outcome.isError) throw new Error(text || `Tool ${tool.name} failed`);
				return text;
			},
		})),
		timeoutMs: options.timeoutMs ?? Number.POSITIVE_INFINITY,
		memoryLimitBytes: 256 * 1024 * 1024,
	});
	let result: CodemodeResult;
	try {
		result = await sandbox.execute(code, { signal });
	} finally {
		await sandbox.close();
	}
	const parts = result.output.map((item) => (item.type === "text" ? item.text : `[image ${item.mimeType}]`));
	if (result.ok && result.value !== undefined) parts.push(valueText(result.value));
	if (!result.ok) parts.push(`Script error: ${result.error.message}`);
	const text = await bounded(parts.join("\n"), options.maxOutputTokens ?? 10_000);
	if (!result.ok) throw new Error(text);
	return { content: [{ type: "text" as const, text }], details: { calls: result.calls } };
}

function runProgram(ctx: ExtensionToolContext, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
	if (!ctx.isProjectTrusted()) throw new Error("Saved programs run only in a trusted project");
	return runScript(ctx, programScript(readProgram(ctx.cwd, name), args), signal);
}

function hasMessages(ctx: ExtensionContext): boolean {
	try {
		return ctx.sessionManager.getBranch().some((entry) => entry.type === "message");
	} catch {
		return true;
	}
}

export function installPrograms(pi: ExtensionAPI): void {
	const sync = (cwd: string) => {
		try {
			for (const program of listPrograms(cwd))
				pi.registerTool({
					name: programToolName(program.name),
					label: program.name,
					description: `Run the saved program ${PROGRAMS_DIRECTORY}/${program.name}.js: ${program.description}`,
					parameters: Type.Unsafe<Record<string, unknown>>({
						type: "object",
						properties: program.parameters,
						required: program.required,
						additionalProperties: false,
					}),
					reachesTools: () => "all",
					execute: (_id, args, signal, _update, ctx) => runProgram(ctx, program.name, args, signal),
				});
		} catch {}
	};
	pi.on("session_start", (_event, ctx) => sync(ctx.cwd));
	pi.on("session_compact", (_event, ctx) => sync(ctx.cwd));
	pi.on("before_agent_start", (_event, ctx) => {
		if (!hasMessages(ctx)) sync(ctx.cwd);
	});
}
