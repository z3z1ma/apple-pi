import { RETRY_MS } from "../../src/client.js";
import { statePaths } from "../../src/paths.js";
import { ReviewJobs } from "../../src/review-jobs.js";
import { Runtime } from "../../src/runtime.js";

if (!process.send || !process.env.PI_CODING_AGENT_DIR) throw new Error("Run through the isolated cancellation test");
ReviewJobs.prototype.wake = () => {};
const runtime = new Runtime(statePaths());
const waits: Array<() => void> = [];
const timeout = globalThis.setTimeout;
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
	if (delay === RETRY_MS && new Error().stack?.includes("ReviewJobs.waitCleanup")) {
		const index = waits.push(() => callback(...args)) - 1;
		process.send?.({ type: "waiting", index });
		return timeout(() => {}, 0);
	}
	return timeout(callback, delay, ...args);
}) as typeof setTimeout;
process.on("message", (message: { type: "release"; index: number } | { type: "stop" }) => {
	if (message.type === "release") waits[message.index]?.();
	else {
		runtime.stop();
		process.exit(0);
	}
});
process.on("disconnect", () => {
	runtime.stop();
	process.exit(0);
});
await runtime.start();
process.send({ type: "ready" });
