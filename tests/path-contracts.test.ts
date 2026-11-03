import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const repository = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repository, "lint/path-contracts.mjs");
const biome = join(repository, "node_modules/.bin/biome");
const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
	const directory = mkdtempSync(join(tmpdir(), "path-contracts-"));
	directories.push(directory);
	for (const [path, text] of Object.entries({ "components/example/main.runtime.ts": "export {};", ...files })) {
		const file = join(directory, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	}
	return directory;
}

function check(files: Record<string, string>) {
	return spawnSync(process.execPath, [checker, fixture(files)], { encoding: "utf8", timeout: 10000 });
}

test.each([
	"export enum State { Waiting, Done }",
	"export namespace State { export const waiting = true; }",
	"export class State { constructor(private value: number) {} }",
	"export class State { constructor(readonly value: number) {} }",
	"const value = <number>1;",
	"import Path = require('node:path');",
])("daemon closure refuses non-erasable syntax in an unsuffixed dependency: %s", (source) => {
	const result = check({
		"components/example/main.runtime.ts": "import './helper.js';",
		"components/example/helper.ts": source,
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toMatch(/helper\.ts.*(?:erasable|parameter properties)/);
});

test.each(["electron", "react", "react/jsx-runtime", "react-dom/client", "happy-dom", "./view.css"])(
	"daemon closure refuses UI import %s",
	(module) => {
		const result = check({ "components/example/main.runtime.ts": `import '${module}';` });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("not UI imports");
	},
);

test("type-only modules are not executed, while dynamic value imports are followed", () => {
	const safe = check({
		"components/example/main.runtime.ts": "import type { State } from './types.js'; const state: State = 0;",
		"components/example/types.ts": "export enum State { Waiting }",
	});
	expect(safe.status, safe.stderr).toBe(0);
	const dynamic = check({
		"components/example/main.runtime.ts": "await import('./helper.js');",
		"components/example/helper.ts": "import 'electron';",
	});
	expect(dynamic.status).toBe(1);
	expect(dynamic.stderr).toContain("not UI imports");
	const commonjs = check({
		"components/example/main.runtime.ts":
			"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); require('./helper.cjs');",
		"components/example/helper.cjs": "require('react-dom');",
	});
	expect(commonjs.status).toBe(1);
	expect(commonjs.stderr).toContain("not UI imports");
});

test("worker entries keep their suffix and their dependencies obey the same Node contract", () => {
	const missingSuffix = check({
		"components/example/main.runtime.ts":
			"import { Worker as Thread } from 'node:worker_threads'; new Thread(new URL('./job.ts', import.meta.url));",
		"components/example/job.ts": "export {};",
	});
	expect(missingSuffix.status).toBe(1);
	expect(missingSuffix.stderr).toContain(".worker.ts URL");
	const invalidDependency = check({
		"components/example/job.worker.ts": "import './helper.js';",
		"components/example/helper.ts": "export enum State { Waiting }",
	});
	expect(invalidDependency.status).toBe(1);
	expect(invalidDependency.stderr).toContain("erasable TypeScript");
});

test("hot contracts follow helper imports, so moving blocking work to an ordinary helper does not evade them", () => {
	const result = check({
		"components/example/read.hot.ts": "export { load } from './helper.js';",
		"components/example/helper.ts": "import { readFileSync as load } from 'node:fs'; export { load };",
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("Hot paths use bounded file reads");
	const computed = check({
		"components/example/read.hot.ts": "const fs = await import('node:fs'); export const load = fs['readFile'];",
	});
	expect(computed.status).toBe(1);
	expect(computed.stderr).toContain("Hot paths use bounded file reads");
});

test("worker execution keeps its Node contract without inheriting the launching thread's hot context", () => {
	const result = check({
		"components/example/start.hot.ts":
			"import { Worker } from 'node:worker_threads'; new Worker(new URL('./job.worker.ts', import.meta.url));",
		"components/example/job.worker.ts":
			"import { readFileSync } from 'node:fs'; export const data = readFileSync('file');",
	});
	expect(result.status, result.stderr).toBe(0);
});

test("bounded reads, async children and erasable fields remain allowed", () => {
	const result = check({
		"components/example/read.hot.ts":
			"import { open } from 'node:fs/promises'; import { spawn } from 'node:child_process'; export { open, spawn };",
		"components/example/main.runtime.ts":
			"import { Worker as Thread } from 'node:worker_threads'; new Thread(new URL('./job.worker.ts', import.meta.url));",
		"components/example/job.worker.ts":
			"class State { private value: number; constructor(value: number) { this.value = value; } }",
	});
	expect(result.status, result.stderr).toBe(0);
});

function lintHot(source: string, hot = true) {
	const directory = fixture({});
	const name = hot ? "read.hot.ts" : "setup.ts";
	writeFileSync(join(directory, name), source);
	writeFileSync(
		join(directory, "biome.json"),
		JSON.stringify({
			overrides: [{ includes: ["**/*.hot.ts"], plugins: [resolve(repository, ".pi/rules/hot-bounded-io.grit")] }],
		}),
	);
	return spawnSync(biome, ["lint", name], { cwd: directory, encoding: "utf8", timeout: 10000 });
}

test.each([
	"import { readFileSync as load } from 'node:fs'; load('file');",
	"import * as fs from 'node:fs/promises'; await fs.readFile('file');",
	"import { execSync } from 'node:child_process'; execSync('git');",
	"import { execFileSync } from 'node:child_process'; execFileSync('git');",
	"import { spawnSync } from 'node:child_process'; spawnSync('git');",
])("the path-scoped GritQL rule rejects blocking hot APIs: %s", (source) => {
	const result = lintHot(source);
	expect(result.status, result.stdout + result.stderr).toBe(1);
	expect(result.stdout + result.stderr).toContain("Hot paths use bounded file reads");
});

test("the hot rule allows bounded operations and does not restrict a cold file", () => {
	expect(lintHot("import { open } from 'node:fs/promises'; await open('file');").status).toBe(0);
	expect(lintHot("import { readFileSync } from 'node:fs'; readFileSync('file');", false).status).toBe(0);
});
