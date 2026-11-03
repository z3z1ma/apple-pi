import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const require = createRequire(import.meta.url);

export interface RuleViolation {
	line: number;
	message: string;
}

export interface RuleRun {
	violations: RuleViolation[];
	failure?: string;
}

interface Diagnostic {
	category?: string;
	message?: string;
	location?: { start?: { line?: number } };
}

function biomeBinary(): string {
	return require.resolve("@biomejs/biome/bin/biome");
}

export function sampleName(grit: string): string {
	return /^\s*language\s+css\b/m.test(grit) ? "sample.css" : "sample.tsx";
}

export async function runRule(plugin: string, fileName: string, content: string): Promise<RuleRun> {
	const dir = mkdtempSync(join(tmpdir(), "repo-rules-"));
	try {
		writeFileSync(
			join(dir, "biome.json"),
			JSON.stringify({ linter: { enabled: true, rules: { recommended: false } }, plugins: [plugin] }),
		);
		mkdirSync(join(dir, "src"));
		const file = join("src", basename(fileName));
		writeFileSync(join(dir, file), content);
		const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve) =>
			execFile(
				process.execPath,
				[biomeBinary(), "lint", file, "--reporter=json"],
				{ cwd: dir, timeout: 20_000, maxBuffer: 16 << 20 },
				(_error, out, err) => resolve({ stdout: String(out), stderr: String(err) }),
			),
		);
		let report: { diagnostics?: Diagnostic[] };
		try {
			report = JSON.parse(stdout);
		} catch {
			const text = `${stdout}\n${stderr}`.replace(/[━]+/g, "").trim();
			return { violations: [], failure: `${basename(plugin)} could not run: ${text.slice(0, 400)}` };
		}
		const fromPlugin = (report.diagnostics ?? []).filter((diagnostic) => diagnostic.category === "plugin");
		const errored = fromPlugin.find((diagnostic) => / errored: /.test(diagnostic.message ?? ""));
		if (errored) return { violations: [], failure: errored.message };
		return {
			violations: fromPlugin.map((diagnostic) => ({
				line: diagnostic.location?.start?.line ?? 0,
				message: diagnostic.message ?? "",
			})),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
