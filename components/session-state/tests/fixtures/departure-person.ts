import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxSession, type Reply } from "../../../../tests/helpers/faux-session.js";
import bridge from "../../src/index.js";

interface Configuration {
	cwd: string;
	person: string;
	manager: string;
	file?: string;
	flagFree?: boolean;
	holdHandoff?: boolean;
	busy?: boolean;
	emptyHandoff?: boolean;
	afterClose?: "exit" | "hold" | "switch";
	successor?: string;
	statusFile?: string;
}
const configuration = JSON.parse(process.argv[2]!) as Configuration;
mkdirSync(configuration.cwd, { recursive: true });
const report = (event: Record<string, unknown>) => {
	const value = { ...event, pid: process.pid };
	process.send?.(value);
	if (configuration.statusFile) appendFileSync(configuration.statusFile, `${JSON.stringify(value)}\n`);
};
let release: (() => void) | undefined;
const gate = configuration.holdHandoff
	? new Promise<void>((resolve) => {
			release = resolve;
		})
	: Promise.resolve();
let releaseBusy: (() => void) | undefined;
const busyGate = new Promise<void>((resolve) => {
	releaseBusy = resolve;
});
const prose =
	"\nVerified retained context: RETAINED_DEPARTURE_FACT.\nUncertainty: the next operator decision is still open.\n\n";
const charged = (text: string, cost: number) => {
	const message = fauxAssistantMessage(text);
	message.usage.cost.total = cost;
	return message;
};
let current: Awaited<ReturnType<typeof fauxSession>> | undefined;
let ending = false;
const keepAlive = setInterval(() => {}, 1000);

async function open(person: string, file?: string) {
	const manager = file
		? SessionManager.open(file)
		: SessionManager.create(configuration.cwd, join(configuration.cwd, "sessions"), { id: person });
	if (!file) manager.appendMessage(charged("RETAINED_DEPARTURE_FACT", 2));
	current = await fauxSession(
		[
			(pi) => {
				const flag = pi.getFlag.bind(pi);
				pi.getFlag = (name) => (name === "reports-to" && !configuration.flagFree ? configuration.manager : flag(name));
				bridge(pi);
			},
		],
		async (context): Promise<Reply> => {
			if (JSON.stringify(context.messages.at(-1)).includes("BUSY_ORDINARY_WORK")) {
				report({ type: "busy" });
				await busyGate;
				return fauxAssistantMessage("Ordinary busy work completed.");
			}
			const handoff = JSON.stringify(context.messages.at(-1)).includes("final handoff");
			report({ type: "model", handoff });
			if (!handoff) return fauxAssistantMessage("Noted.");
			report({
				type: "handoff",
				retained: JSON.stringify(context.messages).includes("RETAINED_DEPARTURE_FACT"),
				busyDone: JSON.stringify(context.messages).includes("Ordinary busy work completed."),
			});
			await gate;
			return charged(configuration.emptyHandoff ? "" : prose, 3);
		},
		[],
		{ cwd: configuration.cwd, sessionManager: manager },
	);
	current.session.setSessionName(person === configuration.person ? "Retained Worker" : "Successor Worker");
	await current.session.bindExtensions({
		shutdownHandler: () => {
			void end();
		},
		onError: (error) => report({ type: "extension-error", error: String(error.error) }),
	});
	report({ type: "ready", person: manager.getSessionId(), file: manager.getSessionFile() });
	if (configuration.busy && person === configuration.person) void current.session.prompt("BUSY_ORDINARY_WORK");
}

async function end() {
	if (ending) return;
	ending = true;
	if (current) {
		await current.session.abort();
		await current.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		current.dispose();
		current = undefined;
	}
	report({ type: "closed" });
	if (configuration.afterClose === "switch" && configuration.successor) {
		await open(configuration.successor);
		ending = false;
	} else if (configuration.afterClose !== "hold") {
		clearInterval(keepAlive);
		process.exit(0);
	}
}
process.on("message", (message) => {
	if (message === "release") release?.();
	if (message === "release-busy") releaseBusy?.();
	if (message === "exit") process.exit(0);
});
process.on("SIGTERM", () => {
	report({ type: "signal", signal: "SIGTERM" });
	process.exit(0);
});
await open(configuration.person, configuration.file);
