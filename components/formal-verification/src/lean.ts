import { access, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cacheDir, download, pinned, runProcess } from "./toolchain.js";

export const ELAN_VERSION = "4.2.4";
export const LEAN_TOOLCHAIN = "leanprover/lean4:v4.35.0";
const ELAN_BUILDS: Record<string, { target: string; checksum: string }> = {
	"darwin-arm64": {
		target: "aarch64-apple-darwin",
		checksum: "7ad829861392c718dfebde3a83b5c8508df47be02af68894b094b0b3952616e5",
	},
	"darwin-x64": {
		target: "x86_64-apple-darwin",
		checksum: "8a340b309d8ed2e96f930761fa223b3af57a38f5d253b53ac90293c9516f8cd4",
	},
	"linux-arm64": {
		target: "aarch64-unknown-linux-gnu",
		checksum: "05febd124d84ebf994b2e7479922a5650b1e950c17ae3bd1ddd776b65bb72bf9",
	},
	"linux-x64": {
		target: "x86_64-unknown-linux-gnu",
		checksum: "42b94d4244e8353142c456ec0e4ca6528fd898a6c604d4059f494e706e431f63",
	},
};
const STANDARD_AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);

export type LeanVerdict = "pass" | "incomplete" | "error";

export interface LeanTheorem {
	name: string;
	axioms?: string[];
	problem?: string;
}

export interface LeanDiagnostic {
	line: number;
	column: number;
	severity: "error" | "warning" | "information";
	text: string;
}

export interface LeanResult {
	verdict: LeanVerdict;
	message: string;
	theorems: LeanTheorem[];
	diagnostics: LeanDiagnostic[];
	toolchain: string;
	project?: string;
	output: string;
}

export interface LeanOptions {
	file: string;
	source: string;
	theorems?: string[];
	build?: boolean;
	timeLimit?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function elanHome(signal?: AbortSignal, onLine?: (line: string) => void): Promise<string> {
	for (const home of [process.env.ELAN_HOME, join(homedir(), ".elan")])
		if (home && (await exists(join(home, "bin", "elan")))) return home;
	const home = cacheDir("elan", ELAN_VERSION);
	if (await exists(join(home, "bin", "elan"))) return home;
	const build = ELAN_BUILDS[`${process.platform}-${process.arch}`];
	if (!build)
		throw new Error(`lean_check runs on macOS and Linux (x64 or arm64), not ${process.platform}-${process.arch}.`);
	const archive = cacheDir("elan", `elan-${ELAN_VERSION}-${build.target}.tar.gz`);
	await pinned(archive, build.checksum, () =>
		download(
			`https://github.com/leanprover/elan/releases/download/v${ELAN_VERSION}/elan-${build.target}.tar.gz`,
			build.checksum,
			signal,
		),
	);
	const scratch = await mkdtemp(join(tmpdir(), "elan-"));
	try {
		const missing = "Installing elan needs tar on PATH.";
		await runProcess("tar", { args: ["-xzf", archive, "-C", scratch], cwd: scratch, signal }, missing);
		const install = await runProcess(
			join(scratch, "elan-init"),
			{
				args: ["-y", "--no-modify-path", "--default-toolchain", "none"],
				cwd: scratch,
				env: { ...process.env, ELAN_HOME: home },
				signal,
				onLine,
			},
			"elan-init is missing from the elan archive.",
		);
		if (install.exitCode !== 0) throw new Error(`elan-init failed:\n${install.output}`);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	return home;
}

export async function leanProject(file: string): Promise<{ root: string; lake: boolean } | undefined> {
	for (let directory = dirname(file); ; directory = dirname(directory)) {
		if ((await exists(join(directory, "lakefile.lean"))) || (await exists(join(directory, "lakefile.toml"))))
			return { root: directory, lake: true };
		if (await exists(join(directory, "lean-toolchain"))) return { root: directory, lake: false };
		if (dirname(directory) === directory) return undefined;
	}
}

function withoutComments(source: string): string {
	let result = "";
	let depth = 0;
	for (let i = 0; i < source.length; i++) {
		if (source.startsWith("/-", i)) {
			depth++;
			i++;
		} else if (depth && source.startsWith("-/", i)) {
			depth--;
			i++;
		} else if (depth) {
			if (source[i] === "\n") result += "\n";
		} else if (source.startsWith("--", i)) {
			while (i < source.length && source[i] !== "\n") i++;
			result += "\n";
		} else result += source[i];
	}
	return result;
}

export function declaredTheorems(source: string): string[] {
	const scopes: { namespace: string[] }[] = [];
	const names: string[] = [];
	for (const line of withoutComments(source).split("\n")) {
		const opened = /^\s*namespace\s+([^\s]+)/.exec(line);
		if (opened) {
			scopes.push({ namespace: opened[1].split(".") });
			continue;
		}
		if (/^\s*(?:noncomputable\s+)?section\b/.test(line)) {
			scopes.push({ namespace: [] });
			continue;
		}
		if (/^\s*end\b/.test(line)) {
			scopes.pop();
			continue;
		}
		const theorem =
			/^\s*(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|nonrec|unsafe|partial)\s+)*(?:theorem|lemma)\s+([^\s:({[⦃]+)/.exec(
				line,
			);
		if (!theorem) continue;
		const name = theorem[1];
		names.push(
			name.startsWith("_root_.")
				? name.slice("_root_.".length)
				: [...scopes.flatMap((scope) => scope.namespace), name].join("."),
		);
	}
	return names;
}

interface LeanMessage {
	pos: { line: number; column: number };
	severity: LeanDiagnostic["severity"];
	data: string;
	kind?: string;
}

function messages(stdout: string): LeanMessage[] {
	return stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as LeanMessage];
			} catch {
				return [];
			}
		});
}

export function audit(names: string[], audited: LeanMessage[]): LeanTheorem[] {
	return names.map((name, index) => {
		const found = audited.filter((message) => message.pos.line === index + 1);
		const error = found.find((message) => message.severity === "error");
		if (error) return { name, problem: error.data };
		const text = found.map((message) => message.data).join("\n");
		if (/does not depend on any axioms/.test(text)) return { name, axioms: [] };
		const listed = /depends on axioms: \[([^\]]*)\]/.exec(text);
		if (!listed) return { name, problem: text || "Lean printed no axioms for it" };
		return {
			name,
			axioms: listed[1]
				.split(",")
				.map((axiom) => axiom.trim())
				.filter(Boolean),
		};
	});
}

function summary(theorems: LeanTheorem[], diagnostics: LeanDiagnostic[], timedOut: boolean): [LeanVerdict, string] {
	const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
	if (errors.length) return ["error", `Lean reported ${errors.length} error${errors.length === 1 ? "" : "s"}.`];
	if (timedOut) return ["incomplete", "The time limit stopped Lean before it finished the file."];
	const sorry = diagnostics.some((diagnostic) => /declaration uses [`']sorry/.test(diagnostic.text));
	const unaudited = theorems.filter((theorem) => theorem.problem);
	const trusting = theorems.filter((theorem) => theorem.axioms?.some((axiom) => !STANDARD_AXIOMS.has(axiom)));
	if (sorry || trusting.length || unaudited.length) {
		const reasons = [
			sorry ? "a declaration uses sorry" : "",
			trusting.length
				? `${trusting.map((theorem) => theorem.name).join(", ")} rely on axioms beyond the standard three`
				: "",
			unaudited.length ? `${unaudited.map((theorem) => theorem.name).join(", ")} could not be audited` : "",
		].filter(Boolean);
		return ["incomplete", `Not proved: ${reasons.join("; ")}.`];
	}
	if (!theorems.length)
		return ["incomplete", "The file elaborates, but it declares no theorem to audit; name them with `theorems`."];
	return [
		"pass",
		`Every audited theorem is proved and depends only on standard axioms (propext, Classical.choice, Quot.sound).`,
	];
}

export async function runLean(options: LeanOptions): Promise<LeanResult> {
	const home = await elanHome(options.signal, options.onLine);
	const bin = (tool: string) => join(home, "bin", tool);
	const env = { ...process.env, ELAN_HOME: home };
	const file = resolve(options.file);
	const project = await leanProject(file);
	const cwd = project?.root ?? dirname(file);
	const pin = project ? [] : [`+${LEAN_TOOLCHAIN}`];
	const missing = `elan's ${home}/bin is incomplete; remove it and retry.`;
	const run = (tool: string, args: string[], extra: { input?: string; timeLimit?: number } = {}) =>
		runProcess(bin(tool), { args, cwd, env, signal: options.signal, onLine: options.onLine, ...extra }, missing);
	const prepared = await run("lean", [...pin, "--version"]);
	const version = /version ([^,\s]+)/.exec(prepared.stdout)?.[1];
	const toolchain = version ? `Lean ${version}` : project ? "the project's toolchain" : LEAN_TOOLCHAIN;
	const base = {
		toolchain,
		project: project?.root,
		theorems: [] as LeanTheorem[],
		diagnostics: [] as LeanDiagnostic[],
	};
	if (prepared.exitCode !== 0)
		return { ...base, verdict: "error", message: "The Lean toolchain did not start.", output: prepared.output };
	if (options.build && project?.lake) {
		const built = await run("lake", ["build"], { timeLimit: options.timeLimit });
		if (built.exitCode !== 0)
			return { ...base, verdict: "error", message: "`lake build` failed.", output: built.output };
	}
	const names = options.theorems?.length ? options.theorems : declaredTheorems(options.source);
	const length = options.source.split("\n").length;
	const input = `${options.source}\n${names.map((name) => `#print axioms ${name}`).join("\n")}\n`;
	const command = project?.lake ? ["env", "lean", "--json", "--stdin"] : [...pin, "--json", "--stdin"];
	const checked = await run(project?.lake ? "lake" : "lean", command, {
		input,
		timeLimit: options.timeLimit,
	});
	const all = messages(checked.stdout);
	const diagnostics = all
		.filter((message) => message.pos.line <= length)
		.map((message) => ({
			line: message.pos.line,
			column: message.pos.column,
			severity: message.severity,
			text: message.data,
		}));
	const theorems = audit(
		names,
		all
			.filter((message) => message.pos.line > length)
			.map((message) => ({ ...message, pos: { ...message.pos, line: message.pos.line - length } })),
	);
	if (checked.exitCode !== 0 && !all.length && !checked.timedOut)
		return { ...base, verdict: "error", message: "Lean failed before checking the file.", output: checked.output };
	const [verdict, message] = summary(theorems, diagnostics, checked.timedOut);
	return { ...base, theorems, diagnostics, verdict, message, output: checked.output };
}
