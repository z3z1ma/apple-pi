import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getStatusNote } from "./status-note.js";
import type { AgentRecord } from "./types.js";

/** Resolve caller-facing paths against the root session's working directory. */
export function resolveAgentOutputPath(outputPath: string | undefined, cwd: string): string | undefined {
	if (outputPath === undefined) return undefined;
	if (outputPath.length === 0) throw new Error("output_path must not be empty.");
	return isAbsolute(outputPath) ? outputPath : resolve(cwd, outputPath);
}

/** Persist one invocation's final response verbatim before its completion is reported. */
export function persistAgentOutput(record: AgentRecord, responseMessageMarker?: string): void {
	if (!record.outputPath) return;
	try {
		mkdirSync(dirname(record.outputPath), { recursive: true });
		writeFileSync(record.outputPath, record.result ?? "", "utf8");
		record.outputWritten = true;
		if (responseMessageMarker !== undefined) {
			record.persistedAssistantMessageMarkers ??= [];
			if (!record.persistedAssistantMessageMarkers.includes(responseMessageMarker)) {
				record.persistedAssistantMessageMarkers.push(responseMessageMarker);
			}
		}
		record.outputWriteError = undefined;
	} catch (error) {
		record.outputWritten = false;
		record.outputWriteError = error instanceof Error ? error.message : String(error);
	}
}

/** Keep successfully persisted responses out of the parent transcript. */
export function formatAgentOutput(record: AgentRecord, inlineOutput: string): string {
	if (!record.outputPath) return inlineOutput;
	if (record.outputWriteError) {
		return `Failed to write agent output to ${record.outputPath}: ${record.outputWriteError}\n\n${inlineOutput}`;
	}
	if (!record.outputWritten) return inlineOutput;
	const failure = record.status === "error" ? `Agent failed: ${record.error ?? "unknown error"}\n\n` : "";
	return `${failure}Agent output written to ${record.outputPath}.${getStatusNote(record.status)}`;
}
