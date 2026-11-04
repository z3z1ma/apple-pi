import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let root = here;
while (!existsSync(join(root, ".ledger")) && dirname(root) !== root) root = dirname(root);
const models = process.argv.slice(2).length
	? process.argv.slice(2)
	: ["openai/gpt-6.1-sol", "anthropic/claude-opus-5-5"];
const realAgent = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const scratch = mkdtempSync(join(tmpdir(), "prompt-capture-"));
const agent = join(scratch, "agent");
mkdirSync(agent);
for (const entry of readdirSync(realAgent))
	if (entry !== "state" && entry !== "sessions") symlinkSync(join(realAgent, entry), join(agent, entry));
const payloadFile = join(scratch, "payload.json");
const extension = join(scratch, "capture.ts");
writeFileSync(
	extension,
	`import { writeFileSync } from "node:fs";\nexport default function (pi: any) {\n\tpi.on("before_provider_request", (event: { payload: unknown }) => {\n\t\twriteFileSync(${JSON.stringify(payloadFile)}, JSON.stringify(event.payload, null, 1));\n\t\tthrow new Error("system prompt captured; request not sent");\n\t});\n}\n`,
);
const env = { ...process.env, PI_CODING_AGENT_DIR: agent };
const runtimePid = () => {
	const file = join(agent, "state", "apple-pi-runtime.pid");
	return existsSync(file) ? Number(readFileSync(file, "utf8")) : undefined;
};

function run(command, args, options) {
	return new Promise((resolve) => {
		const child = spawn(command, args, options);
		child.once("close", resolve);
	});
}

async function startRuntime() {
	const starter = join(scratch, "start-runtime.mjs");
	writeFileSync(
		starter,
		`import { spawnRuntime } from ${JSON.stringify(join(root, "components/session-state/src/client.ts"))};\nspawnRuntime(() => {});\nsetTimeout(() => process.exit(0), 4000);\n`,
	);
	await run(process.execPath, ["--import", join(root, "components/session-state/src/register.mjs"), starter], {
		cwd: root,
		env,
		stdio: "ignore",
	});
}

function capture(model) {
	return new Promise((resolve) => {
		rmSync(payloadFile, { force: true });
		const pi = spawn(
			"pi",
			["--mode", "rpc", "--session-dir", join(scratch, "sessions"), "-e", extension, "--model", model],
			{ cwd: root, env, stdio: ["pipe", "pipe", "ignore"] },
		);
		let buffer = "";
		const finish = () => {
			clearTimeout(timer);
			pi.kill("SIGTERM");
			setTimeout(() => resolve(existsSync(payloadFile) ? readFileSync(payloadFile, "utf8") : undefined), 1500);
		};
		const timer = setTimeout(finish, 150_000);
		pi.stdout.on("data", (chunk) => {
			buffer += chunk;
			for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
				const line = buffer.slice(0, at);
				buffer = buffer.slice(at + 1);
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (event.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.method))
					pi.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true })}\n`);
				if (existsSync(payloadFile) || event.type === "agent_end") return finish();
			}
		});
		setTimeout(() => pi.stdin.write(`${JSON.stringify({ type: "prompt", message: "Hello." })}\n`), 12_000);
	});
}

try {
	await startRuntime();
	for (const model of models) {
		const payload = await capture(model);
		const name = `payload-${model.split("/")[0]}.json`;
		if (payload) writeFileSync(join(here, "capture", name), payload);
		console.log(payload ? `captured ${name}` : `no payload for ${model}`);
	}
} finally {
	for (let tries = 0; tries < 5; tries++) {
		const pid = runtimePid();
		if (!pid) break;
		try {
			process.kill(pid);
		} catch {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	rmSync(scratch, { recursive: true, force: true });
}
