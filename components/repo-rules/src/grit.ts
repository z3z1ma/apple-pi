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

function biomeBinary(): string {
	return require.resolve("@biomejs/biome/bin/biome");
}

export async function ruleViolations(path: string, content: string, plugins: string[]): Promise<RuleViolation[]> {
	if (!plugins.length) return [];
	const dir = mkdtempSync(join(tmpdir(), "repo-rules-"));
	try {
		writeFileSync(
			join(dir, "biome.json"),
			JSON.stringify({ linter: { enabled: true, rules: { recommended: false } }, plugins }),
		);
		mkdirSync(join(dir, "src"));
		const file = join("src", basename(path));
		writeFileSync(join(dir, file), content);
		const output = await new Promise<string>((resolve) =>
			execFile(
				process.execPath,
				[biomeBinary(), "lint", file, "--reporter=json"],
				{ cwd: dir, timeout: 20_000, maxBuffer: 16 << 20 },
				(_error, stdout) => resolve(stdout),
			),
		);
		const report = JSON.parse(output || "{}") as {
			diagnostics?: { category?: string; message?: string; location?: { start?: { line?: number } } }[];
		};
		return (report.diagnostics ?? [])
			.filter((diagnostic) => diagnostic.category === "plugin")
			.map((diagnostic) => ({ line: diagnostic.location?.start?.line ?? 0, message: diagnostic.message ?? "" }));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
