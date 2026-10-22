import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { type BtwConversation, createBtwConversation } from "../../btw/src/session.js";
import bridge from "../src/index.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

test("a person's private BTW conversation creates no person or incarnation", async () => {
	let context!: ExtensionContext;
	const parent = await fauxSession(
		[
			bridge,
			(pi) => {
				pi.on("before_agent_start", (_event, ctx) => {
					context = ctx;
				});
			},
		],
		[fauxAssistantMessage("Main answer"), fauxAssistantMessage("Private answer")],
		[],
	);
	let conversation: BtwConversation | undefined;
	try {
		await parent.session.prompt("Main work");
		const id = parent.session.sessionId;
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select id, kind from sessions")).toEqual([{ id, kind: "root" }]),
		);
		const incarnations = query(state.dbPath, "select session_id, pid from incarnations");
		conversation = await createBtwConversation(context);
		expect(await conversation.submit("A private question")).toBe(true);
		await vi.waitFor(() => expect(conversation?.status).toBe("completed"));
		await conversation.close();
		expect(query(state.dbPath, "select id, kind from sessions")).toEqual([{ id, kind: "root" }]);
		expect(query(state.dbPath, "select session_id, pid from incarnations")).toEqual(incarnations);
	} finally {
		await conversation?.close();
		await close(parent);
	}
});
