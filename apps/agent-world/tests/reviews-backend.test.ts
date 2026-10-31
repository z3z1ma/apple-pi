import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterEach, expect, test, vi } from "vitest";
import type { CodeReviewPage } from "../../../components/browser-pages/src/page-data.js";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { openCommands } from "../src/backend/commands.js";
import { openReviews } from "../src/backend/reviews.js";

let state: ReturnType<typeof tempStateDir>;
let bridge: Awaited<ReturnType<typeof fakeBridge>>;
let process_: ReturnType<typeof standInProcess>;
let commands: ReturnType<typeof openCommands>;
let reviews: ReturnType<typeof openReviews>;
afterEach(async () => {
	reviews?.close();
	commands?.close();
	bridge?.socket.destroy();
	process_?.child.kill();
	if (state) await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("Workplace previews, queues, reads retained source and commits browser approval over its explicit runtime", async () => {
	state = tempStateDir();
	mkdirSync(join(state.agentDir, "bin"));
	writeFileSync(
		join(state.agentDir, "bin", "pi"),
		`#!/bin/sh\nexec '${process.execPath}' '${new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname}' "$@"\n`,
		{ mode: 0o700 },
	);
	vi.stubEnv("PATH", `${join(state.agentDir, "bin")}:${process.env.PATH}`);
	mkdirSync(join(state.agentDir, "roles"));
	writeFileSync(
		join(state.agentDir, "roles", "code-review-specialist.md"),
		'---\ntitle: Reviewer\nmandate: Inspect source.\nmodels: ["fixture/code-review-specialist:high"]\nwrites: false\nmanages: false\n---\nInspect the captured source.\n',
	);
	const cwd = join(state.agentDir, "checkout");
	mkdirSync(cwd);
	const git = (...args: string[]) => execFileSync("git", args, { cwd });
	git("init", "-q");
	writeFileSync(join(cwd, "value.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	writeFileSync(join(cwd, "value.ts"), "export const value = 2;\n");
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ review: true }));
	await startRuntime(state.socketPath);
	process_ = standInProcess();
	bridge = await fakeBridge(state.socketPath, "owner", process_.pid, process_.startedAt, { session: { cwd } });
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'owner'")).toHaveLength(1));
	commands = openCommands(state.socketPath);
	reviews = openReviews(state.dbPath, commands);
	const api = reviews.api;
	const request = { cwd, target: { kind: "working-tree" as const, base: "HEAD" } };
	const preview = await api.preview(request);
	expect(preview.changedPaths).toBe(1);
	expect(preview.lines.join("\n")).toContain(preview.digest);
	const input = { attempt: "capture", request, expectedDigest: preview.digest, owner: "owner" };
	const job = await api.enqueue(input);
	await vi.waitFor(async () => expect((await api.queue({ cwd, limit: 1 })).page?.rows[0]?.state).toBe("completed"), {
		timeout: 15000,
	});
	expect((await api.enqueue(input)).id).toBe(job.id);
	writeFileSync(join(cwd, "value.ts"), "export const value = 999;\n");
	expect(await api.source({ review: job.id, side: "after", path: "value.ts", limit: 1 })).toMatchObject({
		page: { rows: ["export const value = 2;"] },
	});
	expect(await api.freshness({ review: job.id })).toMatchObject({ requestedTarget: "changed", checkout: "changed" });
	await expect(api.manage({ attempt: "forged", operation: { action: "approve" } as never })).rejects.toThrow();
	const pageSession = await api.signOff({ review: job.id });
	const html = await (await fetch(pageSession.url)).text();
	const page = JSON.parse(
		/<script id="page-data" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!,
	) as CodeReviewPage;
	expect(page.capture?.digest).toBe(job.digest);
	expect(page.capture?.freshness).toMatchObject({
		requestedTarget: "not checked",
		checkout: "not checked",
		policy: "not checked",
		checkedAt: null,
	});
	expect(
		Object.values(page.hunks)
			.flatMap((hunk) => hunk.lines)
			.map((line) => line.s.map((segment) => segment.t).join(""))
			.join("\n"),
	).not.toContain("999");
	const post = (capture: unknown) =>
		fetch(new URL("/result", pageSession.url), {
			method: "POST",
			headers: { "x-page-token": page.session.token },
			body: JSON.stringify({ verdict: "approve", comments: [], decisions: [], seen: [], capture }),
		});
	const binding = {
		review: job.id,
		digest: job.digest,
		revision: page.capture!.revision,
		planRevision: page.capture!.planRevision,
		acceptLimits: true,
	};
	expect((await post({ ...binding, digest: "tampered" })).status).toBe(400);
	const browser = await chromium.launch({
		executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		headless: true,
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(pageSession.url);
		await page.getByRole("button", { name: /Finish review/ }).click();
		await page.locator(".vd-opt.vd-approve").click();
		const submit = page.getByRole("button", { name: "Record verdict" });
		expect(await submit.isEnabled()).toBe(false);
		await page.getByRole("checkbox").check();
		await page.screenshot({ path: "/tmp/review-captured-browser.png", animations: "disabled" });
		const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/result");
		await submit.click();
		expect((await response).status()).toBe(200);
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
	}
	expect((await api.queue({ cwd, limit: 1 })).page?.rows[0]?.approval).toMatchObject({
		matchesAssessment: true,
		record: { actor: "operator", digest: job.digest },
	});
	expect(readFileSync(join(cwd, "value.ts"), "utf8")).toContain("999");
}, 30000);
