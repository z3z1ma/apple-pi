import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { runInFork } from "../../shared/src/fork-context.js";
import installProviderFailover from "../src/controller.js";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof fauxSession>>[] = [];

async function fixture(
	setting: unknown,
	options: { capability?: boolean; program?: string; projectOptIn?: boolean } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-failover-controller-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir);
	mkdirSync(cwd);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ providerFailover: setting }));
	if (options.projectOptIn) {
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ providerFailover: true }));
	}
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_PROGRAM_ID", options.program ?? "");
	const select = vi.fn(async () => true);
	const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
	const installer: ExtensionFactory = (pi) => {
		installProviderFailover(
			new Proxy(pi, {
				get(target, key, receiver) {
					if (key === "setModelIfUnchanged") return options.capability ? select : undefined;
					return Reflect.get(target, key, receiver);
				},
			}),
		);
	};
	const run = await fauxSession([installer], [], [], { cwd });
	sessions.push(run);
	return { run, select, warnings };
}

afterEach(() => {
	for (const run of sessions.splice(0)) run.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("provider failover initialization", () => {
	it("ignores project opt-in and leaves ordinary sessions unchanged", async () => {
		const { run, select, warnings } = await fixture(false, { capability: true, projectOptIn: true });
		await run.session.prompt("Hello");
		expect(run.requests).toHaveLength(1);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	});

	it("visibly disables recovery without the native capability while healthy work continues", async () => {
		const { run, warnings } = await fixture(true);
		const mind = { model: run.session.model, thinking: run.session.thinkingLevel };
		expect(warnings).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lacks guarded model selection"));
		await run.session.prompt("Hello");
		expect(run.requests).toHaveLength(1);
		expect({ model: run.session.model, thinking: run.session.thinkingLevel }).toEqual(mind);
		const notices = run.session.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "provider-failover");
		expect(notices).toHaveLength(1);
		expect(JSON.stringify(run.requests[0]!.messages)).not.toContain("guarded model selection");
	});

	it("does not resolve a missing model catalog or change a healthy mind", async () => {
		const { run, select, warnings } = await fixture(true, { capability: true });
		const mind = { model: run.session.model, thinking: run.session.thinkingLevel };
		await run.session.prompt("Hello");
		await run.session.prompt("Continue");
		expect(run.requests).toHaveLength(2);
		expect({ model: run.session.model, thinking: run.session.thinkingLevel }).toEqual(mind);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	});

	it("disables malformed opt-in without exposing its value or breaking healthy work", async () => {
		const { run, select, warnings } = await fixture("sensitive-fixture", { capability: true });
		await run.session.prompt("Hello");
		expect(run.requests).toHaveLength(1);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).toHaveBeenCalledOnce();
		expect(String(warnings.mock.calls[0]?.[0])).toContain("providerFailover");
		expect(String(warnings.mock.calls[0]?.[0])).not.toContain("sensitive-fixture");
	});

	it("leaves program peers, including captured-review workers, untouched", async () => {
		const { run, select, warnings } = await fixture("invalid", { capability: true, program: "review-program-control" });
		await run.session.prompt("Hello");
		expect(run.requests).toHaveLength(1);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	});

	it("leaves internal forked continuations untouched", async () => {
		await runInFork({ sessionId: "private-fork-control" }, async () => {
			const { run, select, warnings } = await fixture("invalid", { capability: true });
			await run.session.prompt("Hello");
			expect(run.requests).toHaveLength(1);
			expect(select).not.toHaveBeenCalled();
			expect(warnings).not.toHaveBeenCalled();
		});
	});
});
