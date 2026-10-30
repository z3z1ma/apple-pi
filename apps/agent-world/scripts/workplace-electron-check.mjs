// Real Electron navigation and Org IPC over an isolated runtime; no operator state or model calls.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "apps/agent-world"))) {
	const parent = dirname(root);
	if (parent === root) throw new Error("Cannot find the Agent World checkout.");
	root = parent;
}
const scratch = mkdtempSync(join(tmpdir(), "wp-electron-nav-"));
const state = join(scratch, "state");
const repository = join(scratch, "repository");
mkdirSync(repository);
writeFileSync(join(repository, "example.ts"), "export const answer = 1;\n");
execFileSync("git", ["init", repository], { stdio: "ignore", timeout: 5000 });
const socketPath = join(state, "apple-pi.sock");
const upstreamPath = join(state, "trace-upstream.sock");
const bin = join(scratch, "bin");
mkdirSync(bin);
writeFileSync(
	join(bin, "pi"),
	`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(join(scratch, "unexpected-pi"))}, "Unexpected launch"); process.exit(92);\n`,
);
chmodSync(join(bin, "pi"), 0o755);
const env = {
	...process.env,
	PI_CODING_AGENT_DIR: scratch,
	PI_SESSION_STATE_DISABLED: "",
	HOME: scratch,
	TMUX_TMPDIR: join(scratch, "tmux"),
	TMUX: "",
	TMUX_PANE: "",
	PATH: `${bin}:${process.env.PATH}`,
};
delete env.ELECTRON_RUN_AS_NODE;
const requests = [];
const sockets = new Set();
const query = (sql) => {
	const db = new DatabaseSync(join(state, "apple-pi.db"), { readOnly: true });
	try {
		return db.prepare(sql).all();
	} finally {
		db.close();
	}
};
const waitFor = async (check) => {
	const until = Date.now() + 10000;
	while (!(await check())) {
		if (Date.now() > until) throw new Error("The isolated runtime did not become ready.");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};
let app;
let runtime;
let proxy;
try {
	runtime = spawn(
		process.execPath,
		[
			"--import",
			join(root, "components/session-state/src/register.mjs"),
			join(root, "components/session-state/src/runtime-main.ts"),
		],
		{ env, stdio: "ignore" },
	);
	await waitFor(() => existsSync(socketPath));
	// Trace the real protocol without replacing any runtime or Electron handler.
	renameSync(socketPath, upstreamPath);
	proxy = createServer((client) => {
		const upstream = createConnection(upstreamPath);
		for (const socket of [client, upstream]) {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
			socket.on("error", () => {
				client.destroy();
				upstream.destroy();
			});
		}
		let buffer = "";
		client.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				requests.push(JSON.parse(buffer.slice(0, end)));
				buffer = buffer.slice(end + 1);
			}
		});
		client.pipe(upstream).pipe(client);
	});
	await new Promise((resolve, reject) => {
		proxy.once("error", reject);
		proxy.listen(socketPath, resolve);
	});
	const startedAt = Date.parse(
		execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", timeout: 5000 }).trim(),
	);
	for (const [id, name, reportsTo, manages] of [
		["nav-head", "Navigation Head", null, true],
		["nav-report", "Navigation Report", "nav-head", false],
		["nav-other", "Other Head", null, true],
	]) {
		const link = createConnection(upstreamPath);
		sockets.add(link);
		await once(link, "connect");
		const heartbeat = setInterval(() => {
			if (!link.destroyed) link.write('{"type":"heartbeat"}\n');
		}, 1000);
		link.once("close", () => clearInterval(heartbeat));
		link.write(
			`${JSON.stringify({
				type: "hello",
				session: { id, kind: "root", cwd: scratch, name },
				process: { pid: process.pid, startedAt },
				run: id === "nav-report" ? "thinking" : "idle",
				facts: {
					reportsTo,
					manages,
					role: id === "nav-other" ? null : manages ? "coordinator" : "implementation-engineer",
					self: "## My story\n\nAn isolated navigation fixture.",
				},
			})}\n`,
		);
	}
	await waitFor(() => query("select id from sessions").length === 3);
	app = await electron.launch({
		executablePath:
			process.env.AGENT_WORLD_ELECTRON ||
			join(
				homedir(),
				".pi/agent/agent-world/electron-44.9.0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
			),
		args: [join(root, "apps/agent-world/dist/electron/main.js")],
		env,
	});
	const page = await app.firstWindow();
	await app.evaluate(({ BrowserWindow }) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.setBackgroundThrottling(false);
			window.on("page-title-updated", (event) => event.preventDefault());
			window.setTitle("Workplace verification - isolated test");
			window.hide();
		}
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.locator(".wp-app").waitFor({ timeout: 30000 });
	await page.locator(".wp-surface:not([inert])").waitFor();
	const documentId = await page.evaluate(() => {
		window.workplaceCheckDocument = crypto.randomUUID();
		return window.workplaceCheckDocument;
	});
	assert.equal(new URL(page.url()).search, "");
	assert.equal(await page.title(), "Workplace");
	await page.getByRole("button", { name: "Chat", exact: true }).waitFor();
	await page
		.locator(".wp-chat-sidebar .wp-dm")
		.filter({ hasText: "Navigation Report" })
		.getByRole("img", { name: "Working", exact: true })
		.waitFor();
	assert.equal(await page.locator(".wp-chat-sidebar").getByRole("img", { name: "Working", exact: true }).count(), 1);
	assert.equal((await page.evaluate(() => window.agentWorld.profile("missing-profile"))).ok, false);
	await page.getByRole("button", { name: "Mail", exact: true }).click();
	assert.match(page.url(), /workplace=mail/);
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	assert.match(page.url(), /workplace=chat/);
	await page.getByRole("button", { name: "Code", exact: true }).click();
	await page.getByRole("textbox", { name: "Repository path", exact: true }).fill(repository);
	await page.getByRole("button", { name: "Open", exact: true }).click();
	await page
		.getByRole("complementary", { name: "Files", exact: true })
		.getByRole("button", { name: "example.ts", exact: true })
		.click();
	const editor = page.locator(".wp-code-monaco .monaco-editor");
	await editor.waitFor({ timeout: 15000 });
	await waitFor(async () => (await editor.locator(".view-lines").innerText()).includes("answer"));
	await editor.click({ position: { x: 180, y: 22 } });
	await page.keyboard.press("Meta+a");
	await page.keyboard.insertText("export const answer = 42;\n");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await waitFor(() => readFileSync(join(repository, "example.ts"), "utf8") === "export const answer = 42;\n");
	const fileProof = await page.evaluate(async (root) => {
		const api = window.agentWorld.workspace;
		const read = await api.readFile({ root, path: "example.ts" });
		if (!read.ok) throw new Error(read.reason);
		const stale = await api.saveFile({ root, path: "example.ts", text: "must not replace", baseHash: "stale" });
		const outside = await api.readFile({ root, path: "../outside" });
		const git = await api.gitStatus({ root });
		const resolved = await api.resolvePaths({
			cwd: root,
			paths: ["example.ts", `${root}/example.ts`, "missing.ts", "../outside"],
		});
		return { read, stale, outside, git, resolved };
	}, repository);
	assert.equal(fileProof.read.text, "export const answer = 42;\n");
	assert.equal(fileProof.stale.ok, false);
	assert.equal(fileProof.outside.ok, false);
	assert.equal(fileProof.git.ok, true);
	assert.equal(fileProof.resolved.ok, true);
	assert.deepEqual(
		fileProof.resolved.files,
		["example.ts", `${repository}/example.ts`].map((candidate) => ({
			candidate,
			root: fileProof.read.root,
			path: "example.ts",
		})),
	);
	assert.equal(readFileSync(join(repository, "example.ts"), "utf8"), "export const answer = 42;\n");
	const codeCapture = join(tmpdir(), `workplace-electron-code-${process.pid}.png`);
	await page.screenshot({ path: codeCapture, animations: "disabled" });
	console.log(`Native Code capture: ${codeCapture}`);
	await page.getByRole("button", { name: "Org", exact: true }).click();
	await page.locator(".wp-org-team-card").first().waitFor();
	assert.equal(await page.locator(".wp-org-team-card").count(), 1);
	const directory = page.getByRole("table", { name: "People", exact: true });
	assert.equal(await directory.locator("tbody tr").count(), 3);
	const beforeDirectory = requests.length;
	await directory.getByRole("button", { name: "Person actions: Other Head", exact: true }).click();
	await page.getByRole("menuitem", { name: "Let go", exact: true }).click();
	const departure = page.getByRole("dialog", { name: "Let Other Head go", exact: true });
	await departure.waitFor();
	assert.equal(await departure.getByRole("button", { name: "Let go", exact: true }).isDisabled(), true);
	await departure.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.deepEqual(
		requests
			.slice(beforeDirectory)
			.filter(
				(request) =>
					["read_entry", "read_entries"].includes(request.type) ||
					["retire", "mark_seen", "thread_read"].includes(request.command?.kind),
			),
		[],
	);
	await page.getByRole("button", { name: "Open team: Navigation Head", exact: true }).click();
	await page.locator(".wp-org-tree-node").first().waitFor();
	assert.equal(await page.locator(".wp-org-tree-node").count(), 2);
	const beforeProfile = requests.length;
	const seenBefore = query("select id, seen_at from sessions order by id");
	await page.getByRole("button", { name: "View profile: Navigation Report", exact: true }).click();
	await page.getByLabel("Profile: Navigation Report", { exact: true }).waitFor();
	await page.getByText("An isolated navigation fixture.", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Person actions: Navigation Report", exact: true }).click();
	await page.getByRole("menuitem", { name: "Send home", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	assert.deepEqual(query("select id, seen_at from sessions order by id"), seenBefore);
	assert.deepEqual(
		requests
			.slice(beforeProfile)
			.filter(
				(request) =>
					["read_entry", "read_entries"].includes(request.type) ||
					["mark_seen", "thread_read"].includes(request.command?.kind),
			),
		[],
	);
	await page.getByRole("button", { name: "Close profile", exact: true }).click();
	const capture = join(tmpdir(), `workplace-electron-org-${process.pid}.png`);
	await page.screenshot({ path: capture, animations: "disabled" });
	console.log(`Focused Org capture: ${capture}`);
	const ipc = await page.evaluate(async () => {
		const api = window.agentWorld;
		const methods = [api.orgMove, api.orgStart, api.onOrgStart].map((method) => typeof method);
		const malformedMove = await api.orgMove({});
		const malformedStart = await api.orgStart(null);
		const malformedCallIn = await api.callIn(null);
		const missingCallIn = await api.callIn({
			id: crypto.randomUUID(),
			person: "missing-profile",
			expected: ["missing-profile"],
		});
		const awakeCallIn = await api.callIn({
			id: crypto.randomUUID(),
			person: "nav-report",
			expected: ["nav-report"],
		});
		const events = [];
		let delivered;
		const received = new Promise((resolve) => {
			delivered = resolve;
		});
		const dispose = api.onOrgStart((progress) => {
			events.push(progress);
			delivered();
		});
		const blocked = await api.orgStart({
			id: "blocked-nav-plan",
			cwd: "/not-a-real-org-test-directory",
			goal: "This must never launch.",
			positions: [{ id: "head", role: "coordinator", manager: null, goal: "No launch." }],
		});
		await Promise.race([received, new Promise((resolve) => setTimeout(resolve, 5000))]);
		dispose();
		return { methods, malformedMove, malformedStart, malformedCallIn, missingCallIn, awakeCallIn, blocked, events };
	});
	assert.deepEqual(ipc.methods, ["function", "function", "function"]);
	assert.equal(ipc.malformedMove.ok, false);
	assert.equal(ipc.malformedStart.complete, false);
	assert.equal(ipc.malformedCallIn.ok, false);
	assert.equal(ipc.missingCallIn.ok, false);
	assert.equal(ipc.awakeCallIn.ok, true, JSON.stringify(ipc.awakeCallIn));
	assert.equal(ipc.awakeCallIn.people.length, 1);
	assert.equal(ipc.awakeCallIn.people[0].person, "nav-report");
	assert.equal(ipc.awakeCallIn.people[0].state, "active");
	assert.equal(ipc.blocked.complete, false);
	assert.equal(ipc.blocked.people[0].state, "blocked");
	assert.ok(
		ipc.events.some((progress) => progress.id === "blocked-nav-plan"),
		JSON.stringify(ipc),
	);
	assert.equal(existsSync(join(scratch, "unexpected-pi")), false);
	assert.equal(query("select id from sessions").length, 3);
	assert.deepEqual(query("select command_id from commands where kind = 'start'"), []);
	await page.getByRole("button", { name: "World", exact: true }).click();
	assert.equal(new URL(page.url()).search, "?workplace=world");
	const world = page.frameLocator('iframe[title="Agent World"]');
	await world.locator("#game canvas").waitFor({ timeout: 30000 });
	const worldDocumentId = await world.locator("body").evaluate(() => {
		window.workplaceCheckDocument = crypto.randomUUID();
		return window.workplaceCheckDocument;
	});
	assert.equal(await page.evaluate(() => window.workplaceCheckDocument), documentId);
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	assert.equal(new URL(page.url()).search, "?workplace=chat");
	assert.equal(await page.evaluate(() => window.workplaceCheckDocument), documentId);
	await page.getByRole("button", { name: "World", exact: true }).click();
	assert.equal(await world.locator("body").evaluate(() => window.workplaceCheckDocument), worldDocumentId);
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	assert.equal(await page.evaluate(() => window.workplaceCheckDocument), documentId);
	// A real anchor navigation exercises Electron's exact allow-list; replacing history alone does not.
	await page.evaluate(() => {
		const link = document.createElement("a");
		link.href = "?workplace=org";
		link.id = "org-entry-check";
		link.textContent = "Open Org directly";
		link.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647;background:white;color:black";
		document.body.append(link);
	});
	await page.locator("#org-entry-check").click();
	await page.locator(".wp-org-team-card").first().waitFor({ timeout: 10000 });
	assert.match(page.url(), /workplace=org/);
	assert.equal(await page.evaluate(() => window.workplaceCheckDocument), undefined);
	assert.equal(new URL(page.url()).pathname, "/index.html");
	await page.getByRole("button", { name: "Chat", exact: true }).click();
	assert.match(page.url(), /workplace=chat/);
	assert.equal(await page.title(), "Workplace");
	assert.deepEqual(errors, []);
	console.log(
		"PASS: isolated Electron defaults to Chat, runs Monaco and guarded filesystem/Git IPC, opens Org without reading, bridges blocked Org requests/progress, retains World and the top document across rail switches, and permits explicit Org navigation",
	);
} finally {
	try {
		await app?.close();
	} finally {
		for (const socket of sockets) socket.destroy();
		if (proxy) await new Promise((resolve) => proxy.close(resolve));
		if (runtime && runtime.exitCode === null) {
			const exited = once(runtime, "exit");
			runtime.kill();
			await exited;
		}
		rmSync(scratch, { recursive: true, force: true });
	}
}
