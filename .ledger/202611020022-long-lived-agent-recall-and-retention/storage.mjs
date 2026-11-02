import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createGzip } from "node:zlib";

const [output] = process.argv.slice(2);
if (!output || resolve(output) === process.cwd() || resolve(output).startsWith(`${process.cwd()}/`))
	throw new Error("Use a private output directory.");
const all = JSON.parse(readFileSync(join(output, "inventory-private.json"), "utf8"));
const selected = all.filter((r) => r.search && r.compactions && r.last - r.first > 3 * 86400000);
const rows = [];
for (const row of selected) {
	const before = statSync(row.path);
	const start = performance.now();
	let compressedBytes = 0;
	const stream = createReadStream(row.path).pipe(createGzip());
	for await (const chunk of stream) compressedBytes += chunk.length;
	const elapsedMs = performance.now() - start;
	const raw = readFileSync(row.path, "utf8");
	const entries = raw
		.split("\n")
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [{ entry: JSON.parse(l), bytes: Buffer.byteLength(l) + 1 }];
			} catch {
				return [];
			}
		});
	const last = entries.findLastIndex((e) => e.entry.type === "compaction");
	const keptId = entries[last]?.entry.firstKeptEntryId;
	const kept = entries.findIndex((e) => e.entry.id === keptId);
	// Physical suffix size is only a lower-bound sizing sketch, not a safe logical hot projection.
	const tailBytes = last >= 0 && kept >= 0 ? entries.slice(kept).reduce((n, e) => n + e.bytes, 0) : null;
	const after = statSync(row.path);
	rows.push({
		key: row.key,
		bytes: Buffer.byteLength(raw),
		compressedBytes,
		compressionMs: elapsedMs,
		physicalSuffixFromFirstKeptBytes: tailBytes,
		changedDuringRead: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
	});
}
const stable = rows.filter((r) => !r.changedDuringRead);
const result = {
	measuredAt: new Date().toISOString(),
	files: rows.length,
	stableFiles: stable.length,
	changedDuringRead: rows.length - stable.length,
	bytes: stable.reduce((n, r) => n + r.bytes, 0),
	compressedBytes: stable.reduce((n, r) => n + r.compressedBytes, 0),
	physicalSuffixFromFirstKeptBytes: stable.reduce((n, r) => n + (r.physicalSuffixFromFirstKeptBytes ?? 0), 0),
	rows,
};
writeFileSync(join(output, "storage-aggregate.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
