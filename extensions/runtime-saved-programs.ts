import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const PROJECT_PROGRAMS_DIRECTORY = ".pi/programs";
export const PROJECT_PROGRAM_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PROGRAM_NAME_CHARS = 120;
const MAX_PROGRAM_BYTES = 100_000;
const MAX_DESCRIPTION_CHARS = 300;

export interface SavedProgram {
	name: string;
	description: string;
	code: string;
}

export interface SavedProgramSummary {
	name: string;
	description: string;
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
	const root = realpathSync(cwd);
	const resolved = realpathSync(directory);
	assertContained(root, resolved);
	if (!lstatSync(resolved).isDirectory()) throw new Error(`${directory}: programs directory must be a directory`);
	return resolved;
}

function validatedName(name: string): string {
	if (name.length > MAX_PROGRAM_NAME_CHARS || !PROJECT_PROGRAM_NAME.test(name)) {
		throw new Error("program name must contain lowercase letters, numbers, and single hyphens only");
	}
	return name;
}

function descriptionFrom(code: string, path: string): string {
	const doc = /^\s*\/\*\*([\s\S]*?)\*\//.exec(code)?.[1];
	const description = doc?.match(/^[\t ]*\*?[\t ]*@description[\t ]+([^\r\n]+)$/m)?.[1]?.trim();
	if (!description) throw new Error(`${path}: program must begin with a JSDoc @description`);
	if (description.length > MAX_DESCRIPTION_CHARS) {
		throw new Error(`${path}: program description must be at most ${MAX_DESCRIPTION_CHARS} characters`);
	}
	return description;
}

function readProgram(cwd: string, name: string, directory = existingProgramsDirectory(cwd)): SavedProgram {
	validatedName(name);
	if (!directory) throw new Error(`Unknown pi_exec program: ${name}`);
	const path = join(directory, `${name}.js`);
	if (!existsSync(path)) throw new Error(`Unknown pi_exec program: ${name}`);
	if (!lstatSync(path).isFile()) throw new Error(`${path}: program must be a regular file`);
	const code = readFileSync(path, "utf8");
	if (Buffer.byteLength(code) > MAX_PROGRAM_BYTES) {
		throw new Error(`${path}: program exceeds ${MAX_PROGRAM_BYTES.toLocaleString()} bytes`);
	}
	return { name, description: descriptionFrom(code, path), code };
}

/** List valid project-local programs without evaluating their JavaScript. */
export function listSavedPrograms(cwd: string): SavedProgramSummary[] {
	const directory = existingProgramsDirectory(cwd);
	if (!directory) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
		.map((entry) => entry.name.slice(0, -".js".length))
		.filter((name) => PROJECT_PROGRAM_NAME.test(name))
		.sort((left, right) => left.localeCompare(right))
		.map((name) => {
			const program = readProgram(cwd, name, directory);
			return { name: program.name, description: program.description };
		});
}

/** Load one validated project-local Pi Exec program by its normalized filename. */
export function readSavedProgram(cwd: string, name: string): SavedProgram {
	return readProgram(cwd, name);
}
