// The transcript index's writer, run as a worker thread of the runtime (see `TranscriptIndexer`). Each message names a
// session and its transcript file; the worker brings that session's rows up to date, one session at a time, coalescing
// repeated requests for a session that is already waiting.
import { parentPort, workerData } from "node:worker_threads";
import { indexTranscript, openIndex } from "./transcript-index.js";

const db = openIndex((workerData as { path: string }).path);
const waiting = new Map<string, string>();
let running = false;

async function drain(): Promise<void> {
	if (running) return;
	running = true;
	while (waiting.size) {
		const [sessionId, file] = waiting.entries().next().value as [string, string];
		waiting.delete(sessionId);
		try {
			await indexTranscript(db, sessionId, file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				parentPort!.postMessage({ type: "error", sessionId, message: (error as Error).message });
		}
	}
	running = false;
}

parentPort!.on("message", (message: { sessionId: string; file: string }) => {
	waiting.set(message.sessionId, message.file);
	void drain();
});
