import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const KEY_BYTES = 32;
const keys = new WeakMap<object, Buffer>();

type Checkpoint = { version: 1; dump: string; stubsHash: string; mac: string };

async function keyFor(manager: ExtensionContext["sessionManager"]): Promise<Buffer> {
	if (!manager.getSessionFile()) {
		let key = keys.get(manager);
		if (!key) {
			key = randomBytes(KEY_BYTES);
			keys.set(manager, key);
		}
		return key;
	}
	const agentDir = getAgentDir();
	const path = join(agentDir, "monty-checkpoint.key");
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	let key: Buffer;
	try {
		key = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const candidate = randomBytes(KEY_BYTES);
		try {
			await writeFile(path, candidate, { flag: "wx", mode: 0o600 });
			key = candidate;
		} catch (writeError) {
			if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
			key = await readFile(path);
		}
	}
	if (key.length !== KEY_BYTES) throw new Error("Invalid pi_exec checkpoint key");
	if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0)
		throw new Error("pi_exec checkpoint key must be accessible only to its owner");
	return key;
}

function signature(key: Buffer, entry: Pick<Checkpoint, "version" | "stubsHash" | "dump">): Buffer {
	return createHmac("sha256", key)
		.update(String(entry.version))
		.update("\0")
		.update(entry.stubsHash)
		.update("\0")
		.update(entry.dump)
		.digest();
}

export async function sealCheckpoint(
	manager: ExtensionContext["sessionManager"],
	dump: Uint8Array,
	stubsHash: string,
): Promise<Checkpoint> {
	const entry = { version: 1 as const, dump: Buffer.from(dump).toString("base64"), stubsHash };
	return { ...entry, mac: signature(await keyFor(manager), entry).toString("base64url") };
}

export async function verifyCheckpoint(
	manager: ExtensionContext["sessionManager"],
	entry: unknown,
	stubsHash: string,
): Promise<Uint8Array | undefined> {
	if (!entry || typeof entry !== "object") return undefined;
	const data = entry as Partial<Checkpoint>;
	if (
		data.version !== 1 ||
		data.stubsHash !== stubsHash ||
		typeof data.dump !== "string" ||
		typeof data.mac !== "string"
	)
		return undefined;
	const expected = signature(await keyFor(manager), data as Checkpoint);
	const actual = Buffer.from(data.mac, "base64url");
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
	return Buffer.from(data.dump, "base64");
}
