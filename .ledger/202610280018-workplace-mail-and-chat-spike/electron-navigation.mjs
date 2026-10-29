// Real Electron navigation check in an isolated agent directory; no operator runtime or messages.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "apps/agent-world"))) {
	const parent = dirname(root);
	if (parent === root) throw new Error("Cannot find the Agent World checkout.");
	root = parent;
}
const scratch = mkdtempSync(join(tmpdir(), "wp-electron-nav-"));
let app;
try {
	app = await electron.launch({
		executablePath: join(
			homedir(),
			".pi/agent/agent-world/electron-44.9.0/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
		),
		args: [join(root, "apps/agent-world/dist/electron/main.js")],
		env: { ...process.env, PI_CODING_AGENT_DIR: scratch },
	});
	const page = await app.firstWindow();
	const errors = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.getByRole("link", { name: "Workplace", exact: true }).waitFor({ timeout: 30000 });
	await page.getByRole("link", { name: "Workplace", exact: true }).click();
	await page.locator(".wp-app").waitFor({ timeout: 5000 });
	assert.match(page.url(), /workplace=chat/);
	assert.equal((await page.evaluate(() => window.agentWorld.profile("missing-profile"))).ok, false);
	await page.getByRole("link", { name: "World", exact: true }).click();
	await page.getByRole("link", { name: "Workplace", exact: true }).waitFor({ timeout: 30000 });
	const returned = new URL(page.url());
	assert.equal(returned.pathname, "/index.html");
	assert.equal(returned.search, "");
	assert.deepEqual(errors, []);
	console.log("PASS: real Electron enters workplace, calls the profile bridge, and returns to World");
} finally {
	try {
		await app?.close();
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
