import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { OPERATOR_PAGE_CHANNEL, type OpenOperatorPage } from "../../shared/src/operator-page-events.js";
import bridge from "../src/index.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

const prompt = (id: string) =>
	query<{ prompt: string | null }>(state.dbPath, "select prompt from sessions where id = ?", id)[0]?.prompt ?? null;

test("a session waiting on a sign-off page is asking the operator until the verdict arrives", async () => {
	let submit: () => void = () => {};
	const page = (pi: ExtensionAPI) =>
		pi.registerTool({
			name: "sign_off_page",
			label: "Sign off page",
			description: "Wait for a verdict",
			parameters: Type.Object({}),
			async execute(toolCallId, _params, _signal, _onUpdate, ctx) {
				const verdict = new Promise<void>((resolve) => (submit = resolve));
				pi.events.emit(OPERATOR_PAGE_CHANNEL, {
					sessionId: ctx.sessionManager.getSessionId(),
					toolCallId,
					title: "Plan for the cache",
					closed: verdict,
				} satisfies OpenOperatorPage);
				await verdict;
				return { content: [{ type: "text", text: "approved" }], details: undefined };
			},
		});
	const run = await fauxSession(
		[bridge, page],
		[
			fauxAssistantMessage([fauxToolCall("sign_off_page", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("thanks"),
		],
		["sign_off_page"],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		const turn = run.session.prompt("review it");
		const open = await vi.waitFor(
			() => {
				const value = prompt(id);
				expect(value).not.toBeNull();
				return JSON.parse(value as string);
			},
			{ timeout: 15000 },
		);
		expect(open).toMatchObject({ kind: "sign-off", title: "Plan for the cache" });
		submit();
		await turn;
		await vi.waitFor(() => expect(prompt(id)).toBeNull(), { timeout: 15000 });
	} finally {
		await close(run);
	}
}, 30000);
