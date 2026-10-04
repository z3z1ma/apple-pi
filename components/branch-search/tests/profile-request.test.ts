import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { profileRequest } from "../src/extension.js";

const restore: (() => void)[] = [];
afterEach(() => {
	for (const undo of restore.splice(0)) undo();
});

const model = { id: "m", provider: "p", api: "a" } as unknown as Model<string>;

/** A user-global profile file mapping `quick` to p/m, in a temporary agent directory. */
function profiles(): void {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-profile-request-"));
	writeFileSync(
		join(dir, "model-profiles.json"),
		JSON.stringify({ profiles: { quick: { model: "p/m", thinking: "off" } } }),
	);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	restore.push(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
}

function registry(reply: ReturnType<typeof fauxAssistantMessage>) {
	return {
		find: () => model,
		streamSimple: () => {
			const events = createAssistantMessageEventStream();
			if (reply.stopReason === "error" || reply.stopReason === "aborted")
				events.push({ type: "error", reason: reply.stopReason, error: reply });
			else events.push({ type: "done", reason: "stop", message: reply });
			events.end(reply);
			return events;
		},
	} as never;
}

const USAGE = { input: 40, output: 5, cacheRead: 10, cacheWrite: 2 };

describe("profileRequest", () => {
	it("returns the reply text and usage", async () => {
		profiles();
		const reply = { ...fauxAssistantMessage("hello"), usage: { ...fauxAssistantMessage("").usage, ...USAGE } };
		const answer = await profileRequest(registry(reply))("quick", "prompt", new AbortController().signal);
		expect(answer).toEqual({ text: "hello", usage: expect.objectContaining(USAGE) });
	});

	it("rejects with the error of a failed reply", async () => {
		profiles();
		const reply = {
			...fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" }),
			usage: { ...fauxAssistantMessage("").usage, ...USAGE },
		};
		const failure = await profileRequest(registry(reply))("quick", "prompt", new AbortController().signal).catch(
			(error: unknown) => error,
		);
		expect((failure as Error).message).toBe("overloaded");
	});
});
