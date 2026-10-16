// LOCAL CHECK, not part of the suite: serves the explanation of 72c7ad3 from the prototype's content through the real
// server, with a stand-in tutor, and writes the saved copy and the notes. Run: DEMO_OUT=/tmp/bpx npx vitest run <this file>
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { buildExplainPage, explainTemplate, parseTutorTurn, readerNote } from "../src/explain-change.js";
import { openPageSession } from "../src/page-server.js";
import { embedPage } from "../src/saved-page.js";

const out = process.env.DEMO_OUT ?? "/tmp/bpx";
const params = JSON.parse(readFileSync(new URL("../../../.ledger/202610151241-browser-review-surfaces/checks/explain-demo.json", import.meta.url), "utf8"));

it("serves a demo explanation", { timeout: 600_000 }, async () => {
	mkdirSync(out, { recursive: true });
	const { page, warnings } = await buildExplainPage(params, process.cwd(), "demo-token");
	writeFileSync(join(out, "warnings.json"), JSON.stringify(warnings));
	const template = await explainTemplate(page);
	writeFileSync(join(out, "saved.html"), embedPage(template, { ...page, session: { token: "", live: false, ask: false } }));
	page.session.ask = true;
	const session = await openPageSession(embedPage(template, page), "demo-token", undefined, {
		ask: async (body) => {
			const turn = parseTutorTurn(body, page);
			if (!turn) return undefined;
			appendFileSync(join(out, "turns.jsonl"), `${JSON.stringify(turn)}\n`);
			await new Promise((resolve) => setTimeout(resolve, 500));
			// A stand-in for the tutor, scripted in its voice: one question at a time, built on the reader's answer.
			const talk = [
				"You picked *It makes Shiki faster*. Let's test that with a thought experiment: if the server read **any** path the page asked for, what could `GET /file?path=../../.ssh/id_rsa` send back?",
				"Exactly: `join` walks straight out of the bundle, and the server would read whatever it finds there. So the check is not about speed at all. **Who builds the list of paths the server answers, and from what?** Step 4 shows it.",
				"Right. The server builds that list itself, from the bundle folder, so a request can only name files inside it, with or without the token. Speed comes from a separate decision: reading evidence only on demand. Want to retry Question 3?",
			];
			if (turn.start?.kind === "talk") return talk[Math.min(turn.thread.filter((m) => m.role === "tutor").length, talk.length - 1)];
			return "What do you expect it to do, in one sentence? Then compare with Step 2 and Question 2.";
		},
		note: (body) => appendFileSync(join(out, "notes.txt"), `${readerNote(body, page) ?? "(none)"}\n---\n`),
	});
	writeFileSync(join(out, "url.txt"), session.url);
	await new Promise((resolve) => setTimeout(resolve, 590_000));
	session.close();
});
