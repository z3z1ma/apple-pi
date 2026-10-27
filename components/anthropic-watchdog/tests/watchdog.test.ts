import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const execFile = promisify(execFileCallback);
let certDir: string;
beforeAll(() => {
	certDir = mkdtempSync(join(tmpdir(), "anthropic-watchdog-cert-"));
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			join(certDir, "key.pem"),
			"-out",
			join(certDir, "cert.pem"),
			"-days",
			"1",
			"-subj",
			"/CN=api.anthropic.com",
			"-addext",
			"subjectAltName=DNS:api.anthropic.com,DNS:other.invalid",
		],
		{ stdio: "ignore" },
	);
});
afterAll(() => rmSync(certDir, { recursive: true, force: true }));

async function trial(mode: string) {
	const { stdout } = await execFile(
		process.execPath,
		[
			"--import",
			resolve("components/session-state/src/register.mjs"),
			resolve("components/anthropic-watchdog/tests/transport-trial.ts"),
			certDir,
			mode,
		],
		{
			timeout: 10_000,
			env: { ...process.env, NODE_EXTRA_CA_CERTS: join(certDir, "cert.pem") },
		},
	).catch((error: { stdout?: string; stderr?: string; message: string }) => {
		throw new Error(`${error.message}\nstdout: ${error.stdout ?? ""}\nstderr: ${error.stderr ?? ""}`);
	});
	return JSON.parse(stdout.trim());
}

test("ping-only accepted requests fail and recover through Pi's normal agent retry loop", async () => {
	const result = await trial("initial");
	expect(result, JSON.stringify(result)).toMatchObject({ requests: 2, text: "recovered", stopReason: "stop" });
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test.each(["identity", "gzip", "br", "deflate", "deflate-raw", "zstd"])(
	"%s progress keeps a healthy long response alive on configured Pi transport",
	async (encoding) => {
		const result = await trial(`healthy-${encoding}`);
		expect(result, JSON.stringify(result)).toMatchObject({ requests: 1, stopReason: "stop", retryEvents: [] });
		expect(result.text).toBe("recovered".repeat(8));
		expect(result.pendingTimers).toBe(0);
	},
	15_000,
);

test("zstd initial pings-only stall is watched on the configured Pi transport", async () => {
	const result = await trial("initial-zstd");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 2,
		text: "recovered",
		stopReason: "stop",
		pendingTimers: 0,
	});
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test("disabled native retries leave one stalled request failed without another prompt", async () => {
	const result = await trial("disabled");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 1,
		stopReason: "error",
		retryEvents: [],
		pendingTimers: 0,
	});
}, 15_000);

test("a stalled post-tool request retries while retaining completed work and executing the tool once", async () => {
	const result = await trial("post-tool-stall");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 3,
		text: "recovered",
		stopReason: "stop",
		toolCalls: 1,
		timersDuringTool: [0, 0],
		pendingTimers: 0,
		retainedToolResults: [false, true, true],
	});
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test("one stalled request retries without aborting another in-flight response", async () => {
	const result = await trial("concurrent");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 3,
		text: "recovered",
		stopReason: "stop",
		parallelStop: "stop",
		parallelText: "recovered".repeat(8),
		pendingTimers: 0,
	});
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test("midstream pings do not prevent native recovery after progress stops", async () => {
	const result = await trial("midstream");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 2,
		text: "recovered",
		stopReason: "stop",
		pendingTimers: 0,
	});
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test("retry exhaustion terminates without another retry loop or prompt", async () => {
	const result = await trial("exhaust");
	expect(result, JSON.stringify(result)).toMatchObject({ requests: 2, stopReason: "error", pendingTimers: 0 });
	expect(result.retryEvents).toEqual(["auto_retry_start", "auto_retry_end"]);
}, 15_000);

test("user cancellation stays aborted, releases the timer and starts no retry", async () => {
	const result = await trial("cancel");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 1,
		stopReason: "aborted",
		retryEvents: [],
		pendingTimers: 0,
	});
}, 15_000);

test("thinking and tool argument progress stay healthy; local tools own no response timer", async () => {
	const result = await trial("tools");
	expect(result, JSON.stringify(result)).toMatchObject({
		requests: 2,
		text: "recovered",
		stopReason: "stop",
		retryEvents: [],
		toolCalls: 1,
		timersDuringTool: [0, 0],
		pendingTimers: 0,
	});
}, 15_000);
