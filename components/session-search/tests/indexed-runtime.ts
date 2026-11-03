import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { statePaths } from "../../session-state/src/paths.js";
import { migrate } from "../../session-state/src/schema.js";
import { indexTranscript, openIndex } from "../../session-state/src/transcript-index.hot.js";
import { startRuntime, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";

export async function startRecallRuntime(file: string, records: any[], sessionId = "fixture", normalize = true) {
	const keys = ["PI_CODING_AGENT_DIR", "PI_SESSION_STATE_DISABLED", "TMUX_TMPDIR", "TMUX", "TMUX_PANE"];
	const previous = keys.map((key) => [key, process.env[key]] as const);
	const state = tempStateDir();
	const stop = async () => {
		try {
			await stopRuntime(state);
		} finally {
			for (const [key, value] of previous) vi.stubEnv(key, value);
		}
	};
	try {
		mkdirSync(state.stateDir, { recursive: true });
		const entries = records.map(({ type, id, parentId, timestamp, ...payload }) => ({
			type,
			id,
			parentId: parentId ?? null,
			timestamp: timestamp ?? "2026-11-02T08:00:00Z",
			...payload,
		}));
		if (normalize) writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		const db = new DatabaseSync(state.dbPath);
		try {
			migrate(db);
			db.prepare(
				"insert into sessions (id, name, kind, cwd, run_state, generation, source, updated_at, session_file) values (?, 'Fixture', 'root', ?, 'idle', 1, 'test', 0, ?)",
			).run(sessionId, state.agentDir, file);
			const row = db.prepare(
				"insert into messages (session_id, entry_id, part, at, role, size, preview, source) values (?, ?, '', ?, 'user', 1, '', 'test')",
			);
			for (const entry of entries) row.run(sessionId, entry.id, Date.parse(entry.timestamp));
		} finally {
			db.close();
		}
		const index = openIndex(statePaths().transcriptIndex);
		try {
			await indexTranscript(index, sessionId, file);
		} finally {
			index.close();
		}
		await startRuntime(state.socketPath);
		return { entries, sessionId, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}
