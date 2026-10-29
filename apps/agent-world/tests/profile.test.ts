import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, onTestFinished, test } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

const firstSeen = Date.UTC(2026, 9, 20);
const laterStart = Date.UTC(2026, 9, 21);

test.each([false, true])(
	"world profiles retain hire dates across later incarnations and keep unknown dates unknown (old schema: %s)",
	(legacy) => {
		const dir = mkdtempSync(join(tmpdir(), "world-profile-"));
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
		const path = join(dir, "profile.db");
		const db = new DatabaseSync(path);
		try {
			migrate(db);
			if (legacy) db.exec("alter table sessions drop column hired_at");
			for (const awake of [true, false]) {
				for (const knownHire of [true, false]) {
					const id = `${knownHire ? "hired" : "unknown"}-${awake ? "awake" : "asleep"}`;
					db.prepare(`insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at)
						values (?, 'root', '/example', ?, 'idle', 2, 'bridge', ?)`).run(id, id, laterStart);
					if (knownHire && !legacy) db.prepare("update sessions set hired_at = ? where id = ?").run(firstSeen, id);
					for (const generation of [1, 2]) {
						const startedAt = generation === 1 ? firstSeen : laterStart;
						const endedAt = generation === 2 && awake ? null : startedAt + 1000;
						db.prepare(`insert into incarnations
							(session_id, generation, pid, process_started_at, process_state, started_at, ended_at, source, updated_at)
							values (?, ?, 1, ?, ?, ?, ?, 'bridge', ?)`).run(
							id,
							generation,
							startedAt,
							endedAt === null ? "alive" : "exited",
							startedAt,
							endedAt,
							startedAt,
						);
					}
				}
			}
		} finally {
			db.close();
		}
		const world = openWorldBackend({ db: path, socket: join(dir, "no-runtime.sock") });
		try {
			const snapshot = world.snapshot();
			for (const [people, suffix] of [
				[snapshot.characters, "awake"],
				[snapshot.dormant, "asleep"],
			] as const) {
				expect(people?.find((person) => person.id === `hired-${suffix}`)).toMatchObject({
					hiredAt: legacy ? null : firstSeen,
					startedAt: firstSeen,
				});
				expect(people?.find((person) => person.id === `unknown-${suffix}`)).toMatchObject({
					hiredAt: null,
					startedAt: firstSeen,
				});
			}
		} finally {
			world.close();
		}
	},
);
