import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cacheDir, download, type ProcessResult, pinned, runProcess } from "./toolchain.js";

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
const MODULE = "ApplePiChecked";
const auditProgram = (report: string) => `import Lean
open Lean

def moduleOf (env : Environment) (name : Name) : String :=
  match env.getModuleIdxFor? name with
  | some idx => env.header.moduleNames[idx.toNat]!.toString
  | none => ""

def audit : CoreM Json := do
  let env ← getEnv
  let some idx := env.getModuleIdx? \`${MODULE} | throwError "the checked module did not load"
  let mut rows : Array Json := #[]
  for name in env.header.moduleData[idx.toNat]!.constNames do
    let some info := env.find? name | continue
    let kind := match info with
      | .thmInfo _ => "theorem"
      | .axiomInfo _ => "axiom"
      | _ => "other"
    let axioms := (← collectAxioms name).map fun ax =>
      Json.mkObj [("name", toJson ax.toString), ("module", toJson (moduleOf env ax))]
    let written := (← findDeclarationRanges? name).isSome
    let shown := (privateToUserName? name).getD name
    rows := rows.push (Json.mkObj [("name", toJson shown.toString), ("internal", toJson shown.isInternal), ("written", toJson written), ("kind", toJson kind), ("axioms", Json.arr axioms)])
  return Json.arr rows

#eval show IO Unit from do
  let env ← importModules #[{ module := \`${MODULE} }] {} (trustLevel := 1024)
  let mut modules : Array Json := #[]
  for name in env.header.moduleNames do
    modules := modules.push (Json.mkObj [("name", toJson name.toString), ("olean", toJson (← findOLean name).toString)])
  let (declarations, _) ← audit.toIO { fileName := "audit", fileMap := default } { env }
  let report := Json.mkObj [("module", toJson "${MODULE}"), ("sysroot", toJson (← findSysroot).toString), ("modules", Json.arr modules), ("declarations", declarations)]
  IO.FS.writeFile ${JSON.stringify(report)} report.compress
`;

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

interface Axiom {
	name: string;
	module: string;
}

interface Declaration {
	name: string;
	internal: boolean;
	written: boolean;
	kind: "theorem" | "axiom" | "other";
	axioms: Axiom[];
}

export interface AuditReport {
	module: string;
	sysroot: string;
	modules: { name: string; olean: string }[];
	declarations: Declaration[];
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function launchers(home: string): Promise<boolean> {
	for (const tool of ["elan", "lean", "lake", "leanchecker"])
		if (!(await exists(join(home, "bin", tool)))) return false;
	return true;
}

async function publish(staging: string, home: string): Promise<void> {
	try {
		await rename(staging, home);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
		if (!(await launchers(home))) throw new Error(`${home} is an incomplete elan install; remove it and retry.`);
	}
}

export async function elanHome(signal?: AbortSignal, onLine?: (line: string) => void): Promise<string> {
	for (const home of [process.env.ELAN_HOME, join(homedir(), ".elan"), cacheDir("elan", ELAN_VERSION)])
		if (home && (await launchers(home))) return home;
	const home = cacheDir("elan", ELAN_VERSION);
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
	const staging = await mkdtemp(`${home}.staging-`);
	try {
		const missing = "Installing elan needs tar on PATH.";
		await runProcess("tar", { args: ["-xzf", archive, "-C", scratch], cwd: scratch, signal }, missing);
		const install = await runProcess(
			join(scratch, "elan-init"),
			{
				args: ["-y", "--no-modify-path", "--default-toolchain", "none"],
				cwd: scratch,
				env: { ...process.env, ELAN_HOME: staging },
				signal,
				onLine,
			},
			"elan-init is missing from the elan archive.",
		);
		if (install.exitCode !== 0 || !(await launchers(staging)))
			throw new Error(`elan-init did not complete:\n${install.output}`);
		if (!(await launchers(home))) await publish(staging, home);
	} finally {
		await rm(scratch, { recursive: true, force: true });
		await rm(staging, { recursive: true, force: true });
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

export function diagnostics(stdout: string): LeanDiagnostic[] | undefined {
	const found: LeanDiagnostic[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const message = JSON.parse(line) as {
				pos: { line: number; column: number };
				severity: LeanDiagnostic["severity"];
				data: string;
			};
			found.push({
				line: message.pos.line,
				column: message.pos.column,
				severity: message.severity,
				text: message.data,
			});
		} catch {
			return undefined;
		}
	}
	return found;
}

function isAxiom(value: unknown): value is Axiom {
	const axiom = value as Axiom;
	return (
		typeof axiom === "object" && axiom !== null && typeof axiom.name === "string" && typeof axiom.module === "string"
	);
}

function isDeclaration(value: unknown): value is Declaration {
	const row = value as Declaration;
	return (
		typeof row === "object" &&
		row !== null &&
		typeof row.name === "string" &&
		typeof row.internal === "boolean" &&
		typeof row.written === "boolean" &&
		["theorem", "axiom", "other"].includes(row.kind) &&
		Array.isArray(row.axioms) &&
		row.axioms.every(isAxiom)
	);
}

export function auditReport(text: string): AuditReport | undefined {
	try {
		const report = JSON.parse(text) as Partial<AuditReport>;
		if (report.module !== MODULE || typeof report.sysroot !== "string") return undefined;
		if (!Array.isArray(report.modules) || !Array.isArray(report.declarations)) return undefined;
		const modulesValid = report.modules.every(
			(module) => typeof module?.name === "string" && typeof module?.olean === "string",
		);
		if (!modulesValid || !report.declarations.every(isDeclaration)) return undefined;
		return report as AuditReport;
	} catch {
		return undefined;
	}
}

async function canonical(path: string): Promise<string> {
	return realpath(path).catch(() => resolve(path));
}

async function standardAxioms(report: AuditReport): Promise<(axiom: Axiom) => boolean> {
	const library = `${await canonical(join(report.sysroot, "lib", "lean"))}/`;
	const toolchain = new Set<string>();
	for (const module of report.modules)
		if ((await canonical(module.olean)).startsWith(library)) toolchain.add(module.name);
	return (axiom) => STANDARD_AXIOMS.has(axiom.name) && toolchain.has(axiom.module);
}

async function untrustedModules(report: AuditReport): Promise<string[]> {
	const library = `${await canonical(join(report.sysroot, "lib", "lean"))}/`;
	const names: string[] = [];
	for (const module of report.modules) {
		if (module.name === MODULE) continue;
		const olean = await canonical(module.olean);
		if (!olean.startsWith(library) && !olean.includes("/.lake/packages/")) names.push(module.name);
	}
	return names;
}

export function audit(declared: Declaration[], wanted: string[] | undefined): LeanTheorem[] {
	const named = (declaration: Declaration) => ({
		name: declaration.name,
		axioms: declaration.axioms.map((axiom) => axiom.name),
	});
	if (!wanted?.length)
		return declared.filter((declaration) => declaration.kind === "theorem" && declaration.written).map(named);
	return wanted.map((name) => {
		const matches = declared.filter((declaration) => declaration.name === name);
		if (matches.length > 1) return { name, problem: "the name is ambiguous" };
		const found = matches[0];
		if (!found) return { name, problem: "the file declares no theorem by this name" };
		if (found.kind !== "theorem")
			return { name, problem: `it is ${found.kind === "axiom" ? "an axiom" : "not a theorem"}` };
		return named(found);
	});
}

function failure(phase: string, run: ProcessResult): [LeanVerdict, string] | undefined {
	if (run.timedOut) return ["incomplete", `The time limit stopped ${phase}.`];
	if (run.exitCode !== 0)
		return [
			"error",
			`${phase} ${run.exitCode === null ? "was stopped by a signal" : `exited with status ${run.exitCode}`}.`,
		];
	return undefined;
}

function summary(
	theorems: LeanTheorem[],
	declared: Declaration[],
	found: LeanDiagnostic[],
	wanted: string[] | undefined,
	standard: (axiom: Axiom) => boolean,
): [LeanVerdict, string] {
	const sorry = [
		...new Set([
			...declared
				.filter((declaration) => declaration.axioms.some((axiom) => axiom.name === "sorryAx"))
				.map((declaration) => declaration.name),
			...(found.some((diagnostic) => /declaration uses [`']sorry/.test(diagnostic.text)) ? ["a declaration"] : []),
		]),
	];
	const unaudited = theorems.filter((theorem) => theorem.problem);
	const covered = wanted?.length
		? declared.filter((declaration) => theorems.some((theorem) => theorem.axioms && theorem.name === declaration.name))
		: declared.filter((declaration) => declaration.kind === "theorem");
	const trusting = covered.filter((declaration) => declaration.axioms.some((axiom) => !standard(axiom)));
	const compiler = trusting.some((declaration) =>
		declaration.axioms.some((axiom) => /native_decide|ofReduceBool/.test(axiom.name)),
	);
	const reasons = [
		sorry.length ? `${sorry.join(", ")} ${sorry.length === 1 ? "uses" : "use"} sorry` : "",
		trusting.length
			? `${trusting.map((declaration) => declaration.name).join(", ")} rely on axioms beyond the standard three${compiler ? " (native_decide trusts the compiler)" : ""}`
			: "",
		unaudited.length ? `${unaudited.map((theorem) => `${theorem.name}: ${theorem.problem}`).join("; ")}` : "",
	].filter(Boolean);
	if (reasons.length) return ["incomplete", `Not proved: ${reasons.join("; ")}.`];
	if (!theorems.length) return ["incomplete", "The file elaborates, but it declares no theorem."];
	return [
		"pass",
		"The kernel accepted every declaration, none uses sorry, and every audited theorem depends only on the standard axioms (propext, Classical.choice, Quot.sound) from the toolchain's library.",
	];
}

export async function runLean(options: LeanOptions): Promise<LeanResult> {
	const home = await elanHome(options.signal, options.onLine);
	const file = resolve(options.file);
	const project = await leanProject(file);
	const cwd = project?.root ?? dirname(file);
	const pin = project ? [] : [`+${LEAN_TOOLCHAIN}`];
	const missing = `elan's ${home}/bin is incomplete; remove it and retry.`;
	let deadline: number | undefined;
	const run = (tool: string, args: string[], extra: { env?: NodeJS.ProcessEnv; untimed?: boolean } = {}) => {
		const timeLimit =
			extra.untimed || deadline === undefined ? undefined : Math.max(0.001, (deadline - Date.now()) / 1000);
		return runProcess(
			join(home, "bin", tool),
			{
				args,
				cwd,
				env: { ...process.env, ...extra.env, ELAN_HOME: home },
				signal: options.signal,
				onLine: options.onLine,
				timeLimit,
			},
			missing,
		);
	};
	const prepared = await run("lean", [...pin, "--version"], { untimed: true });
	const version = /version ([^,\s]+)/.exec(prepared.stdout)?.[1];
	const base = {
		toolchain: version ? `Lean ${version}` : project ? "the project's toolchain" : LEAN_TOOLCHAIN,
		project: project?.root,
		theorems: [] as LeanTheorem[],
		diagnostics: [] as LeanDiagnostic[],
	};
	const stopped = (phase: string, step: ProcessResult) => {
		const problem = failure(phase, step);
		return problem && { ...base, verdict: problem[0], message: problem[1], output: step.output };
	};
	const unprepared = stopped("Starting the Lean toolchain", prepared);
	if (unprepared) return unprepared;
	if (options.timeLimit !== undefined) deadline = Date.now() + options.timeLimit * 1000;
	if (options.build && project?.lake) {
		const unbuilt = stopped("`lake build`", await run("lake", ["build"]));
		if (unbuilt) return unbuilt;
	}
	const scratch = await mkdtemp(join(tmpdir(), "lean-check-"));
	try {
		let searchPath = scratch;
		if (project?.lake) {
			const paths = await run("lake", ["env", "printenv", "LEAN_PATH"]);
			const unresolved = stopped("`lake env`", paths);
			if (unresolved) return unresolved;
			searchPath = [scratch, paths.stdout.trim()].filter(Boolean).join(":");
		}
		const env = { LEAN_PATH: searchPath };
		await writeFile(join(scratch, `${MODULE}.lean`), options.source);
		const checked = await run(
			"lean",
			[...pin, "--json", `--root=${scratch}`, "-o", join(scratch, `${MODULE}.olean`), join(scratch, `${MODULE}.lean`)],
			{ env },
		);
		const found = diagnostics(checked.stdout);
		if (!found)
			return { ...base, verdict: "error", message: "Lean printed output that is not JSON.", output: checked.output };
		const withFound = { ...base, diagnostics: found };
		const errors = found.filter((diagnostic) => diagnostic.severity === "error");
		if (errors.length)
			return {
				...withFound,
				verdict: "error",
				message: `Lean reported ${errors.length} error${errors.length === 1 ? "" : "s"}.`,
				output: "",
			};
		const unchecked = failure("Lean", checked);
		if (unchecked) return { ...withFound, verdict: unchecked[0], message: unchecked[1], output: checked.output };
		const reportPath = join(scratch, `audit-${randomUUID()}.json`);
		await writeFile(join(scratch, "Audit.lean"), auditProgram(reportPath));
		const audited = await run("lean", [...pin, join(scratch, "Audit.lean")], { env });
		const unaudited = failure("The axiom audit", audited);
		if (unaudited) return { ...withFound, verdict: unaudited[0], message: unaudited[1], output: audited.output };
		const report = auditReport(await readFile(reportPath, "utf8").catch(() => ""));
		if (!report)
			return {
				...withFound,
				verdict: "error",
				message: "The axiom audit wrote no valid report.",
				output: audited.output,
			};
		const replayed = await run("leanchecker", [...pin, MODULE, ...(await untrustedModules(report))], { env });
		if (replayed.timedOut)
			return {
				...withFound,
				verdict: "incomplete",
				message: "The time limit stopped the kernel replay.",
				output: replayed.output,
			};
		if (replayed.exitCode !== 0)
			return /replaying declaration|\(kernel\)/.test(replayed.output)
				? {
						...withFound,
						verdict: "error",
						message: "The kernel rejected a declaration on replay.",
						output: replayed.output,
					}
				: {
						...withFound,
						verdict: "incomplete",
						message: "The kernel replay (leanchecker) did not run.",
						output: replayed.output,
					};
		const theorems = audit(report.declarations, options.theorems);
		const [verdict, message] = summary(
			theorems,
			report.declarations,
			found,
			options.theorems,
			await standardAxioms(report),
		);
		return { ...withFound, theorems, verdict, message, output: "" };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
