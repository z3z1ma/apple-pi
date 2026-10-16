// LOCAL CHECK, not part of the suite: serves a real closed ledger bundle for review, waits for a browser to submit,
// and writes the model-facing result. Run: DEMO_OUT=/tmp/bpl npx vitest run <this file>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import {
	buildLedgerPage,
	formatLedgerResult,
	ledgerTemplate,
	parseLedgerQuestion,
	parseLedgerResult,
	serveEvidence,
} from "../src/ledger-review.js";
import { openPageSession } from "../src/page-server.js";
import { embedPage } from "../src/saved-page.js";

const out = process.env.DEMO_OUT ?? "/tmp/bpl";

it("serves a demo ledger review and records the submission", { timeout: 600_000 }, async () => {
	mkdirSync(out, { recursive: true });
	const { page, dir } = await buildLedgerPage(
		{
			task: "202610040726-branch-search-challenger-benchmark",
			note: "I split the benchmark into four tickets. Check the graph and the acceptance criteria before I start ticket 01.",
		},
		process.cwd(),
		"demo-token",
	);
	page.session.ask = true;
	const template = await ledgerTemplate(page);
	const session = await openPageSession(embedPage(template, page), "demo-token", (body) => parseLedgerResult(body, page), {
		ask: async (body) => {
			if (!parseLedgerQuestion(body, page)) return undefined;
			await new Promise((resolve) => setTimeout(resolve, 600));
			return "Ticket 03 needs both: the runner has nothing to run without the traps (02), and its third arm needs the challenger pass (01).";
		},
		file: (path) => serveEvidence(page, dir, path),
	});
	writeFileSync(join(out, "url.txt"), session.url);
	const result = await session.result;
	session.close();
	writeFileSync(join(out, "result.txt"), formatLedgerResult(page, result, "/tmp/saved.html"));
	writeFileSync(join(out, "saved.html"), embedPage(template, { ...page, session: { token: "", live: false, ask: false }, result }));
});
