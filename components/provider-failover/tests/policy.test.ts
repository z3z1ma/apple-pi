import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { ROLE_ENTRY } from "../../organization/src/session-role.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { failoverCandidates, nextFailoverCandidate, requiresImages } from "../src/policy.js";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof fauxSession>>[] = [];

async function fixture(profile = "coding", role: string | null = "implementation-engineer") {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-failover-policy-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	const path = join(agentDir, "model-profiles.json");
	const models = [
		{ model: "openai/source", thinking: "high" },
		{ model: "anthropic/target", thinking: "medium" },
		{ model: "antigravity/visual", thinking: "high" },
		{ model: "xai/unwanted", thinking: "high" },
		{ model: "unregistered/absent", thinking: "high" },
		{ model: "inactive/disabled", thinking: "high" },
		{ model: "routing/virtual", thinking: "high" },
	];
	writeFileSync(path, JSON.stringify({ profiles: { [profile]: { selection: "round-robin", models } } }));
	let ctx!: ExtensionContext;
	const run = await fauxSession(
		[
			(pi) => {
				pi.on("session_start", (_event, context) => {
					ctx = context;
				});
			},
		],
		[],
		[],
	);
	sessions.push(run);
	expect(ctx).toBeDefined();
	if (role)
		run.session.sessionManager.appendCustomEntry(ROLE_ENTRY, { role, mind: { model: "old/source", thinking: "high" } });
	const registered = models
		.filter(({ model }) => !model.startsWith("unregistered/"))
		.map(({ model }) => {
			const [provider, id] = model.split("/");
			return {
				...run.session.model!,
				provider,
				id,
				reasoning: true,
				api: provider === "routing" ? "pi-virtual" : run.session.model!.api,
				input: provider === "antigravity" ? ["text", "image"] : ["text"],
			} as Model<string>;
		});
	vi.spyOn(ctx.modelRegistry, "find").mockImplementation((provider, id) =>
		registered.find((model) => model.provider === provider && model.id === id),
	);
	vi.spyOn(ctx.modelRegistry, "hasConfiguredAuth").mockImplementation((model) => model.provider !== "inactive");
	return { ctx, registered };
}

afterEach(() => {
	for (const run of sessions.splice(0)) run.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("existing-profile failover policy", () => {
	it("uses role workload without historical profile provenance or round-robin consumption", async () => {
		const { ctx, registered } = await fixture();
		expect(resolveModelProfile("coding", ctx.modelRegistry).model.provider).toBe("openai");
		const candidates = failoverCandidates(ctx);
		expect(candidates.map(({ model, thinking }) => [model.provider, thinking])).toEqual([
			["openai", "high"],
			["anthropic", "medium"],
			["antigravity", "high"],
		]);
		expect(failoverCandidates(ctx)).toEqual(candidates);
		expect(resolveModelProfile("coding", ctx.modelRegistry)).toMatchObject({
			model: { provider: "anthropic", id: "target" },
			thinking: "medium",
		});
		registered[1]!.id = "later-registry-change";
		expect(candidates[1]!.model.id).toBe("target");
	});

	it("uses coordination suitability for an unroled root", async () => {
		const { ctx } = await fixture("coordination", null);
		expect(failoverCandidates(ctx).map(({ name, model }) => [name, model.provider])).toEqual([
			["coordination", "openai"],
			["coordination", "anthropic"],
			["coordination", "antigravity"],
		]);
	});

	it("stops when the recorded role cannot be resolved", async () => {
		const { ctx } = await fixture("coordination", "missing-role");
		expect(() => failoverCandidates(ctx)).toThrow("Cannot resolve the recorded role");
	});

	it("stops when the role's configured profile is absent", async () => {
		const { ctx } = await fixture("coordination");
		expect(() => failoverCandidates(ctx)).toThrow('profile "coding" is not configured');
	});

	it("selects in configured order, skips every attempted provider and preserves destination effort", async () => {
		const { ctx } = await fixture();
		const candidates = failoverCandidates(ctx);
		expect(nextFailoverCandidate(candidates, new Set(["openai"]), false)?.thinking).toBe("medium");
		expect(nextFailoverCandidate(candidates, new Set(["openai", "anthropic"]), false)?.model.provider).toBe(
			"antigravity",
		);
		expect(nextFailoverCandidate(candidates, new Set(["openai", "anthropic", "antigravity"]), false)).toBeUndefined();
		expect(nextFailoverCandidate(candidates, new Set(["openai"]), true)?.model.provider).toBe("antigravity");
	});

	it("stops when the pool has no distinct provider", async () => {
		const { ctx } = await fixture();
		const candidates = failoverCandidates(ctx).filter(({ model }) => model.provider === "openai");
		expect(nextFailoverCandidate(candidates, new Set(["openai"]), false)).toBeUndefined();
	});

	it("recognizes relevant image inputs, including tool results and custom pending messages", () => {
		const image = { type: "image", data: "synthetic", mimeType: "image/png" } as const;
		const messages: AgentMessage[] = [
			{ role: "user", content: [image], timestamp: 1 },
			{ role: "toolResult", content: [image], toolCallId: "call", toolName: "tool", isError: false, timestamp: 1 },
			{ role: "custom", customType: "fixture", content: [image], display: true, timestamp: 1 },
		];
		for (const message of messages) expect(requiresImages([message])).toBe(true);
		expect(requiresImages([{ role: "user", content: "text", timestamp: 1 }])).toBe(false);
		expect(requiresImages([])).toBe(false);
	});
});
