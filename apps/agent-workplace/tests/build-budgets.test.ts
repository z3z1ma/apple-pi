import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import { budget, latency } from "../../../tests/helpers/build-budgets.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

const ROOT = join(import.meta.dirname, "../../..");
const dir = mkdtempSync(join(tmpdir(), "apple-pi-workplace-budget-"));
const dbPath = join(dir, "world.db");
const AWAKE = 40;
const ASLEEP = 3000;

beforeAll(() => {
	mkdirSync(dir, { recursive: true });
	const db = new DatabaseSync(dbPath);
	try {
		migrate(db);
		const now = Date.now();
		const person = db.prepare(
			"insert into sessions (id, kind, cwd, name, run_state, generation, reports_to, source, updated_at) values (?, 'root', ?, ?, 'idle', 1, ?, 'fixture', ?)",
		);
		const incarnation = db.prepare(
			"insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, ended_at, source, updated_at) values (?, 1, ?, ?, ?, ?, ?, 'fixture', ?)",
		);
		db.exec("begin");
		for (let i = 0; i < AWAKE + ASLEEP; i++) {
			const id = `person-${i}`;
			person.run(id, `/projects/repository-${i % 30}`, `Person ${i}`, i ? "person-0" : null, now);
			incarnation.run(id, 10000 + i, now - i, i < AWAKE ? "alive" : "exited", now - i, i < AWAKE ? null : now, now);
		}
		db.exec("commit");
	} finally {
		db.close();
	}
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the normal Workplace entry's static chunk closure stays within its gzip budget", async () => {
	const previous = process.env.NODE_ENV;
	vi.stubEnv("NODE_ENV", "production");
	const result = await build({
		configFile: join(ROOT, "apps/agent-workplace/web/vite.config.ts"),
		mode: "production",
		logLevel: "silent",
		build: { write: false },
	}).finally(() => {
		if (previous === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previous;
	});
	expect(Array.isArray(result)).toBe(false);
	if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one Workplace output bundle");
	const chunks = new Map(
		result.output.filter((output) => output.type === "chunk").map((chunk) => [chunk.fileName, chunk]),
	);
	const entries = [...chunks.values()].filter((chunk) => chunk.isEntry || chunk.name === "workplace");
	expect(entries.some((chunk) => chunk.name === "workplace")).toBe(true);
	const files = new Set<string>();
	const visit = (file: string) => {
		if (files.has(file)) return;
		files.add(file);
		const chunk = chunks.get(file);
		if (!chunk) return;
		for (const dependency of chunk.imports) visit(dependency);
		const metadata = (chunk as typeof chunk & { viteMetadata?: { importedCss: Set<string> } }).viteMetadata;
		for (const css of metadata?.importedCss ?? []) files.add(css);
	};
	for (const chunk of entries) visit(chunk.fileName);
	const sizes = [...files].map((file) => {
		const output = result.output.find((output) => output.fileName === file);
		if (!output) throw new Error(`Missing built first-load dependency: ${file}`);
		const bytes = output.type === "chunk" ? output.code : output.source;
		return { file, gzip: gzipSync(bytes).length };
	});
	budget(
		"Workplace first-load gzip bytes",
		sizes.reduce((sum, row) => sum + row.gzip, 0),
		242514,
		{ files: sizes },
	);
}, 60000);

test("the full Workplace snapshot build stays within its latency budget", async () => {
	const measured = await latency(() => {
		const backend = openWorldBackend({ db: dbPath, socket: join(dir, "absent.sock") });
		try {
			const snapshot = backend.snapshot();
			expect(snapshot.characters).toHaveLength(AWAKE);
			expect(snapshot.dormant).toHaveLength(ASLEEP);
			expect(snapshot.workplace).toBeDefined();
		} finally {
			backend.close();
		}
	});
	budget("Workplace snapshot p95 ms", measured.p95, 37, { ...measured, awake: AWAKE, asleep: ASLEEP });
}, 30000);
