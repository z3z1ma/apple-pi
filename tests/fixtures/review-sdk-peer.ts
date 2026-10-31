import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ROLE_ENTRY } from "../../components/organization/src/session-role.js";
import bridge from "../../components/session-state/src/index.js";
import { fauxSession } from "../helpers/faux-session.js";
import { type ReviewInput, reviewReply } from "./review-reply.js";

const flag = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1]!;
const id = flag("session-id");
const role = flag("role");
const manager = flag("reports-to");
const directory = process.env.PI_CODING_AGENT_DIR!;
const records = join(directory, "provider-inputs");
mkdirSync(records, { recursive: true });
const sessionManager = SessionManager.inMemory(process.cwd(), { id });
sessionManager.appendCustomEntry(ROLE_ENTRY, {
	role,
	mind: { model: "faux-session-provider/faux-session-model", thinking: "off" },
	soul: {
		fragments: [
			{ title: "One", extract: "First" },
			{ title: "Two", extract: "Second" },
			{ title: "Three", extract: "Third" },
		],
	},
});
const db = new DatabaseSync(join(directory, "state", "apple-pi.db"), { readOnly: true });
const row = db.prepare("select input from review_attempts where person = ?").get(id) as { input: string };
db.close();
const { contextFile } = JSON.parse(row.input) as { contextFile: string };
let step = 0;
let stopping = false;
let run: Awaited<ReturnType<typeof fauxSession>> | undefined;
async function stop() {
	if (stopping) return;
	stopping = true;
	if (run) {
		await run.session.abort();
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	}
	process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.stdin.on("end", () => void stop());
process.stdin.resume();
try {
	run = await fauxSession(
		[
			(pi) => {
				const getFlag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "role" ? role : name === "reports-to" ? manager : getFlag(name));
				bridge(pi);
			},
		],
		(context) => {
			appendFileSync(join(records, `${id}.jsonl`), `${JSON.stringify(context)}\n`);
			step++;
			if (step === 1)
				return fauxAssistantMessage([fauxToolCall("read", { path: contextFile })], { stopReason: "toolUse" });
			if (step === 2)
				return fauxAssistantMessage([fauxToolCall("read", { path: "value.ts" })], { stopReason: "toolUse" });
			if (step === 3)
				return fauxAssistantMessage(
					[
						fauxToolCall("bash", {
							command: "pwd && git diff --name-only base review -- && rg --no-heading 'export const value' value.ts",
						}),
					],
					{ stopReason: "toolUse" },
				);
			if (step === 4) {
				const input = JSON.parse(readFileSync(contextFile, "utf8")) as ReviewInput;
				return fauxAssistantMessage(
					[fauxToolCall("pi_exec_return", reviewReply(input, { otherReport: "OTHER_FIRST_REPORT_SENTINEL" }))],
					{ stopReason: "toolUse" },
				);
			}
			return fauxAssistantMessage("Review complete.");
		},
		["read", "bash"],
		{ cwd: process.cwd(), sessionManager },
	);
} catch (error) {
	appendFileSync(join(directory, "review-sdk-errors.log"), `${error instanceof Error ? error.stack : error}\n`);
	process.exit(1);
}
