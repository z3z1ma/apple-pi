import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { Type, type TSchema } from "typebox";

export const PROJECT_PROGRAMS_DIRECTORY = ".pi/programs";
export const PROJECT_PROGRAM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PROGRAM_NAME_CHARS = 120;
const MAX_PROGRAM_BYTES = 100_000;
const MAX_DESCRIPTION_CHARS = 300;

export const SAVED_PROGRAM_PROMPT_GUIDELINE =
	"Save reusable Python snippets as .pi/programs/<name>.py with a leading Python docstring: a one-line description, then @param tags such as @param {str} message or @param {int} [count=2]. Use [name] for optional parameters. They register program_<name> tools at cache-safe boundaries and require a trusted project to run. Typed arguments and defaults reach inputs as strings; convert numbers with int()/float() and compare booleans to 'true'.";

export interface ProgramParam {
	name: string;
	type: "string" | "number" | "integer" | "boolean";
	description?: string;
	optional: boolean;
	default?: string | number | boolean;
}

export interface SavedProgram {
	name: string;
	description: string;
	code: string;
	params: ProgramParam[];
}

function assertContained(root: string, path: string): void {
	const pathFromRoot = relative(root, path);
	if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
		throw new Error(`${path}: program path must resolve within the project`);
	}
}

function existingProgramsDirectory(cwd: string): string | undefined {
	const directory = join(cwd, PROJECT_PROGRAMS_DIRECTORY);
	if (!existsSync(directory)) return undefined;
	const resolved = realpathSync(directory);
	assertContained(realpathSync(cwd), resolved);
	if (!lstatSync(resolved).isDirectory()) throw new Error(`${directory}: programs directory must be a directory`);
	return resolved;
}

function validatedName(name: string): string {
	if (name.length > MAX_PROGRAM_NAME_CHARS || !PROJECT_PROGRAM_NAME.test(name)) {
		throw new Error(
			"program name must contain lowercase letters, numbers, and single hyphens only (at most 120 characters)",
		);
	}
	return name;
}

function parameterType(rawType = "string"): ProgramParam["type"] | undefined {
	switch (rawType.trim().toLowerCase()) {
		case "str":
		case "string":
			return "string";
		case "number":
		case "float":
			return "number";
		case "int":
		case "integer":
			return "integer";
		case "bool":
		case "boolean":
			return "boolean";
		default:
			return undefined;
	}
}

function parameterDefault(raw: string, type: ProgramParam["type"], path: string): string | number | boolean {
	const value = raw.trim();
	if (type === "string" && value) {
		if (value.startsWith('"')) {
			try {
				const parsed: unknown = JSON.parse(value);
				if (typeof parsed === "string") return parsed;
			} catch {
				/* Reject malformed quoted strings below. */
			}
		} else if (value.startsWith("'")) {
			if (/^'(?:[^'\\]|\\['\\])*'$/.test(value)) return value.slice(1, -1).replace(/\\(['\\])/g, "$1");
		} else {
			return value;
		}
	}
	if (type === "boolean" && /^(?:true|false)$/i.test(value)) return value.toLowerCase() === "true";
	if ((type === "number" || type === "integer") && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
		const number = Number(value);
		if (Number.isFinite(number) && (type !== "integer" || Number.isInteger(number))) return number;
	}
	throw new Error(`${path}: invalid ${type} @param default: ${raw}`);
}

function programMetadata(code: string, path: string): Pick<SavedProgram, "description" | "params"> {
	const doc = /^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/.exec(code);
	const lines = (doc?.[1] ?? doc?.[2] ?? "").trim().split(/\r?\n/);
	const description = lines.shift()?.trim();
	if (!description || description.startsWith("@")) {
		throw new Error(`${path}: program must begin with a Python docstring containing a one-line description`);
	}
	if (description.length > MAX_DESCRIPTION_CHARS) {
		throw new Error(`${path}: program description must be at most ${MAX_DESCRIPTION_CHARS} characters`);
	}
	const params: ProgramParam[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		if (!line.trim().startsWith("@param")) continue;
		const match =
			/^\s*@param\s+(?:\{([^}]+)\}\s+)?(?:\[([a-zA-Z_][a-zA-Z0-9_]*)(?:=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]"']+))?\]|([a-zA-Z_][a-zA-Z0-9_]*))(?:\s+(?:-\s*)?(.*))?\s*$/.exec(
				line,
			);
		if (!match) throw new Error(`${path}: malformed @param: ${line.trim()}`);
		const [, rawType, optionalName, rawDefault, requiredName, paramDescription] = match;
		const name = (optionalName ?? requiredName)!;
		const type = parameterType(rawType);
		if (!type) throw new Error(`${path}: unsupported @param type: ${rawType}`);
		if (seen.has(name) || ["inputs", "reset", "limits"].includes(name)) {
			throw new Error(`${path}: duplicate or reserved @param name: ${name}`);
		}
		seen.add(name);
		params.push({
			name,
			type,
			optional: Boolean(optionalName),
			...(rawDefault !== undefined ? { default: parameterDefault(rawDefault, type, path) } : {}),
			...(paramDescription?.trim() ? { description: paramDescription.trim() } : {}),
		});
	}
	return { description, params };
}

function readProgram(cwd: string, name: string, directory = existingProgramsDirectory(cwd)): SavedProgram {
	validatedName(name);
	if (!directory) throw new Error(`Unknown pi_exec program: ${name}`);
	const path = join(directory, `${name}.py`);
	if (!existsSync(path)) throw new Error(`Unknown pi_exec program: ${name}`);
	if (!lstatSync(path).isFile()) throw new Error(`${path}: program must be a regular file`);
	const code = readFileSync(path, "utf8");
	if (Buffer.byteLength(code) > MAX_PROGRAM_BYTES) {
		throw new Error(`${path}: program exceeds ${MAX_PROGRAM_BYTES.toLocaleString()} bytes`);
	}
	return { name, code, ...programMetadata(code, path) };
}

/** Discover regular .py files without executing repository code. Ignore malformed entries. */
export function listSavedPrograms(cwd: string): SavedProgram[] {
	const directory = existingProgramsDirectory(cwd);
	if (!directory) return [];
	const programs: SavedProgram[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
		try {
			programs.push(readProgram(cwd, entry.name.slice(0, -3), directory));
		} catch {
			// An invalid file must not prevent valid neighboring programs from being discovered.
		}
	}
	return programs;
}

/** Load validated project-local Python source afresh; file symlinks are never executable programs. */
export function readSavedProgram(cwd: string, name: string): SavedProgram {
	return readProgram(cwd, name);
}

export function savedProgramToolName(name: string): string {
	return `program_${validatedName(name).replace(/-/g, "_")}`;
}

export function buildProgramParametersSchema(params: ProgramParam[], resetSchema: TSchema, limitsSchema: TSchema) {
	const properties: Record<string, TSchema> = Object.create(null);
	for (const param of params) {
		const options = {
			...(param.description ? { description: param.description } : {}),
			...(param.default !== undefined ? { default: param.default } : {}),
		};
		const base =
			param.type === "number"
				? Type.Number(options)
				: param.type === "integer"
					? Type.Integer(options)
					: param.type === "boolean"
						? Type.Boolean(options)
						: Type.String({ ...options, maxLength: 200_000 });
		properties[param.name] = param.optional ? Type.Optional(base) : base;
	}
	properties.inputs = Type.Optional(
		Type.Record(Type.String(), Type.String({ maxLength: 200_000 }), {
			description: 'Named strings available to the saved Python program as inputs["key"].',
		}),
	);
	properties.reset = resetSchema;
	properties.limits = limitsSchema;
	return Type.Object(properties);
}
