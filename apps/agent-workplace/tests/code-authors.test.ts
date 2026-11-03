import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, test } from "vitest";
import { migrate } from "../../../components/session-state/src/schema.js";
import { lastEditor } from "../src/backend/code-authors.js";

const dir = mkdtempSync(join(tmpdir(), "code-authors-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const path = join(dir, "state.db");
const db = new DatabaseSync(path);
migrate(db);
const session = db.prepare(
	"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, retired_at) values (?, 'pi', ?, ?, 'idle', 1, 'test', 0, ?)",
);
session.run("early", "/repo", "Early Writer", null);
session.run("late", "/repo/sub", "Late Writer", null);
session.run("gone", "/repo", "Gone Writer", 999);
session.run("reader", "/repo", "Reader", null);
const message = db.prepare(
	"insert into messages (session_id, entry_id, part, at, role, tool, size, preview, source, observed_at) values (?, ?, 'call', ?, 'assistant', ?, 1, ?, 'test', 0)",
);
message.run("early", "e1", 10, "edit", "src/main.ts");
message.run("late", "l1", 20, "write", "../src/main.ts");
message.run("gone", "g1", 30, "edit", "/repo/src/main.ts");
message.run("reader", "r1", 40, "read", "src/main.ts");
db.close();

test("the author of a file is the latest present session that edited or wrote it, by the path it resolved", () => {
	expect(lastEditor(path, "/repo/src/main.ts")).toEqual({ id: "late", name: "Late Writer", editedAt: 20 });
	expect(lastEditor(path, "/repo/src/other.ts")).toBeNull();
});
