import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { disposeAgentSession } from "../../subagents/src/session-lifecycle.js";
import { cloneAt } from "../eval/clone.js";
import { realSessions } from "../eval/session.js";
import { initRepo } from "./fixtures.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function setEnv(name: string, value: string): void {
	const previous = process.env[name];
	process.env[name] = value;
	cleanups.push(() => {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	});
}

/** Every file and directory under `dir` with its size and modification time. */
function snapshot(dir: string): Record<string, string> {
	const entries: Record<string, string> = {};
	const walk = (path: string) => {
		for (const name of readdirSync(path)) {
			const full = join(path, name);
			const stat = statSync(full);
			entries[relative(dir, full)] = `${stat.isDirectory() ? "dir" : stat.size} ${stat.mtimeMs}`;
			if (stat.isDirectory()) walk(full);
		}
	};
	walk(dir);
	return entries;
}

/** Credential storage may refresh `auth.json` (and its lock); nothing else may change. */
const credentials = (path: string) => path.startsWith("auth.json");
const withoutCredentials = (entries: Record<string, string>) =>
	Object.fromEntries(Object.entries(entries).filter(([path]) => !credentials(path)));

describe("evaluation sessions", { timeout: 60_000 }, () => {
	it("read the real auth, models, and profiles, and write nothing else to the real agent directory", async () => {
		setEnv("PI_OFFLINE", "1");
		// A built-in model to map the profile to, found without touching either directory.
		const scratch = tempDir("apple-pi-eval-scratch-");
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: join(scratch, "models.json"),
			modelsStorePath: join(scratch, "models-store.json"),
		});
		const [model] = runtime.getModels();
		if (!model) throw new Error("no built-in model");

		const real = tempDir("apple-pi-eval-real-agent-");
		writeFileSync(join(real, "auth.json"), "{}\n");
		writeFileSync(join(real, "settings.json"), "{}\n");
		mkdirSync(join(real, "sessions"));
		writeFileSync(
			join(real, "model-profiles.json"),
			JSON.stringify({ profiles: { coding: { model: `${model.provider}/${model.id}`, thinking: "off" } } }),
		);
		setEnv("PI_CODING_AGENT_DIR", real);
		const repo = tempDir("apple-pi-eval-session-repo-");
		initRepo(repo, { "src/value": "1\n" });
		const clone = await cloneAt(repo, "HEAD", []);
		cleanups.push(clone.dispose);
		const before = snapshot(real);

		const sessions = await realSessions("coding", { agentDir: real });
		expect(sessions.modelLabel).toBe(`${model.provider}/${model.id} (profile coding, thinking off)`);
		const { session, dispose } = await sessions.createSession(clone.dir);
		expect(session.model?.id).toBe(model.id);
		await disposeAgentSession(session);
		await dispose();
		sessions.close();

		expect(withoutCredentials(snapshot(real))).toEqual(withoutCredentials(before));
	});

	it("resolve a profile whose model only the downloaded catalog names, and leave the catalog unchanged", async () => {
		setEnv("PI_OFFLINE", "1");
		const scratch = tempDir("apple-pi-eval-scratch-");
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: join(scratch, "models.json"),
			modelsStorePath: join(scratch, "models-store.json"),
		});
		const builtIn = runtime.getModels().find((model) => model.provider === "openai");
		if (!builtIn) throw new Error("no built-in openai model");
		const real = tempDir("apple-pi-eval-real-agent-");
		setEnv("PI_CODING_AGENT_DIR", real);
		const catalogModel = { ...builtIn, id: "catalog-only-model", name: "Catalog only" };
		writeFileSync(
			join(real, "models-store.json"),
			JSON.stringify({
				[builtIn.provider]: { models: [catalogModel], checkedAt: Date.now(), lastModified: Date.now() },
			}),
		);
		writeFileSync(
			join(real, "model-profiles.json"),
			JSON.stringify({ profiles: { coding: { model: `${builtIn.provider}/catalog-only-model`, thinking: "off" } } }),
		);
		const before = snapshot(real);

		const sessions = await realSessions("coding", { agentDir: real });
		expect(sessions.modelLabel).toContain(`${builtIn.provider}/catalog-only-model`);
		sessions.close();
		expect(withoutCredentials(snapshot(real))).toEqual(withoutCredentials(before));
	});
});
