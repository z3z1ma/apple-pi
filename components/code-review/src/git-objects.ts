import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../../shared/src/git.js";

/** Stage raw blobs, then let Git validate and import their identities in one process. */
export async function blobStore(source: string, format: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
	const directory = join(source, ".git", "capture-objects");
	await mkdir(directory);
	const pending = new Set<string>();
	return {
		async put(data: Buffer) {
			signal?.throwIfAborted();
			const id = createHash(format).update(`blob ${data.length}\0`).update(data).digest("hex");
			if (!pending.has(id)) {
				await writeFile(join(directory, id), data);
				pending.add(id);
			}
			return id;
		},
		async flush() {
			if (!pending.size) return;
			const ids = [...pending];
			const output = await git(source, ["hash-object", "-w", "--no-filters", "--stdin-paths"], {
				env,
				signal,
				input: `${ids.map((id) => JSON.stringify(join(directory, id))).join("\n")}\n`,
			});
			if (output.split("\n").some((id, i) => id !== ids[i]) || output.split("\n").length !== ids.length)
				throw new Error("Git did not confirm the captured blob identities");
		},
		close: () => rm(directory, { recursive: true, force: true }),
	};
}

/** Stream Git's length-delimited blobs without decoding bytes or retaining the whole repository in memory. */
export async function* gitObjects(
	cwd: string,
	ids: string[],
	env: NodeJS.ProcessEnv,
	signal?: AbortSignal,
): AsyncGenerator<Buffer> {
	if (!ids.length) return;
	const child = spawn("git", ["cat-file", "--batch"], {
		cwd,
		env: { ...process.env, ...env },
		signal,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	let closed = false;
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {});
	const completion = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => {
			closed = true;
			if (code === 0) resolve();
			else reject(new Error(`Git blob capture failed: ${stderr.trim() || `exit ${code}`}`));
		});
	});
	void completion.catch(() => {});
	const stream = child.stdout[Symbol.asyncIterator]();
	let buffer: Buffer = Buffer.alloc(0);
	const more = async () => {
		const next = await stream.next();
		if (next.done) throw new Error(`Git blob capture ended early: ${stderr.trim()}`);
		buffer = next.value as Buffer;
	};
	const take = async (size: number) => {
		const parts: Buffer[] = [];
		let remaining = size;
		while (remaining) {
			if (!buffer.length) await more();
			const count = Math.min(remaining, buffer.length);
			parts.push(buffer.subarray(0, count));
			buffer = buffer.subarray(count);
			remaining -= count;
		}
		return Buffer.concat(parts, size);
	};
	const line = async () => {
		const parts: Buffer[] = [];
		for (;;) {
			const end = buffer.indexOf(10);
			if (end >= 0) {
				parts.push(buffer.subarray(0, end));
				buffer = buffer.subarray(end + 1);
				return Buffer.concat(parts).toString("ascii");
			}
			parts.push(buffer);
			await more();
		}
	};
	try {
		child.stdin.end(`${ids.join("\n")}\n`);
		for (const id of ids) {
			const [actual, type, length] = (await line()).split(" ");
			const size = Number(length);
			if (actual !== id || type !== "blob" || !Number.isSafeInteger(size) || size < 0)
				throw new Error(`Git did not return the requested blob: ${id}`);
			const data = await take(size);
			if ((await take(1))[0] !== 10) throw new Error("Invalid Git blob terminator");
			yield data;
		}
		await completion;
	} finally {
		if (!closed) child.kill();
		await completion.catch(() => {});
	}
}
