import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.7.4";
const checksum = "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "apple-pi", "tla2tools", version);
const jar = join(cache, "tla2tools.jar");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = resolve(process.argv[2] || join(root, "specs/command-journal.tla"));
const config = resolve(process.argv[3] || spec.replace(/\.tla$/, ".cfg"));

function verify(bytes) {
	if (createHash("sha256").update(bytes).digest("hex") !== checksum)
		throw new Error(`TLA+ ${version} checksum mismatch: remove ${jar} and retry`);
}

async function tools() {
	try {
		verify(await readFile(jar));
		return;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const url = `https://github.com/tlaplus/tlaplus/releases/download/v${version}/tla2tools.jar`;
	console.log(`Downloading ${url} to ${jar}`);
	const response = await fetch(url);
	if (!response.ok) throw new Error(`TLA+ download failed: ${response.status} ${response.statusText}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	verify(bytes);
	await mkdir(cache, { recursive: true });
	const pending = `${jar}.${process.pid}.tmp`;
	try {
		await writeFile(pending, bytes);
		await rename(pending, jar);
	} finally {
		await rm(pending, { force: true });
	}
}

async function check() {
	await tools();
	const source = await readFile(spec, "utf8");
	const module = /^-+\s+MODULE\s+(\w+)\s+-+$/m.exec(source)?.[1];
	if (!module) throw new Error(`Missing TLA+ module header in ${spec}`);
	const scratch = await mkdtemp(join(tmpdir(), "apple-pi-tlc-"));
	try {
		await writeFile(join(scratch, `${module}.tla`), source);
		await writeFile(join(scratch, `${module}.cfg`), await readFile(config));
		console.log(`TLC ${version}: ${spec} (${config}), 1 worker`);
		const child = spawn(
			"java",
			["-XX:+UseParallelGC", "-cp", jar, "tlc2.TLC", "-workers", "1", "-config", `${module}.cfg`, module],
			{ cwd: scratch, stdio: "inherit" },
		);
		const forward = (signal) => child.kill(signal);
		const interrupt = () => forward("SIGINT");
		const terminate = () => forward("SIGTERM");
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		try {
			process.exitCode = await new Promise((resolve, reject) => {
				child.once("error", reject);
				child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
			});
		} finally {
			process.off("SIGINT", interrupt);
			process.off("SIGTERM", terminate);
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

await check();
