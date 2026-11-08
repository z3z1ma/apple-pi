import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { runInFork } from "../../shared/src/fork-context.js";
import installProviderFailover from "../src/controller.js";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof fauxSession>>[] = [];

async function fixture(program = "") {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-failover-controller-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_PROGRAM_ID", program);
	let api!: ExtensionAPI;
	const replies: Reply[] = [];
	const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
	const installer: ExtensionFactory = (pi) => {
		api = pi;
		installProviderFailover(pi);
	};
	const run = await fauxSession([installer], replies, [], { cwd: root });
	sessions.push(run);
	const select = vi.spyOn(api, "setModel");
	return { run, select, warnings, replies };
}

afterEach(() => {
	for (const run of sessions.splice(0)) run.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("provider failover initialization", () => {
	it("keeps healthy model and effort unchanged without resolving a missing catalog", async () => {
		const { run, select, warnings } = await fixture();
		const mind = { model: run.session.model, thinking: run.session.thinkingLevel };
		await run.session.prompt("Hello");
		await run.session.prompt("Continue");
		expect(run.requests).toHaveLength(2);
		expect({ model: run.session.model, thinking: run.session.thinkingLevel }).toEqual(mind);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	});

	async function excludedFailure(program = "") {
		const { run, select, warnings, replies } = await fixture(program);
		const source = { ...run.session.model!, provider: "antigravity", id: "source" };
		await run.session.setModel(source);
		replies.push(
			Object.assign(
				fauxAssistantMessage("", {
					stopReason: "error",
					errorMessage: "Quota reached. Next: switch models or retry later.",
				}),
				{ provider: source.provider, model: source.id, api: source.api },
			),
		);
		await run.session.prompt("Finish this task");
		expect(run.requests).toHaveLength(1);
		expect(select).not.toHaveBeenCalled();
		expect(warnings).not.toHaveBeenCalled();
	}

	it("leaves captured-review and temporary program peers untouched after quota failure", async () => {
		await excludedFailure("review-program-control");
	});

	it("leaves internal forked continuations untouched after quota failure", async () => {
		await runInFork({ sessionId: "private-fork-control" }, () => excludedFailure());
	});
});
