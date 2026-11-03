import { open } from "node:fs/promises";

/** How much of the transcript one read takes, from the end backwards. */
const CHUNK_BYTES = 1 << 20;

// An entry's own id, parent and timestamp are written together, at the start of the line for most entries
// (`{"type":"message","id":...`) and at its end for those that spread their payload first (`custom_message`, `custom`).
// Payload objects can hold an `"id"` of their own, so the first `"id"` on a line is not always the entry's.
const HEAD = /^\{"type":"[^"]*","id":"([^"]+)",(?:"parentId":(?:null|"[^"]*"),)?"timestamp":"([^"]+)"/;
const TAIL = /"id":"([^"]+)",(?:"parentId":(?:null|"[^"]*"),)?"timestamp":"([^"]+)"\}\s*$/;
/** Enough of a line's start and end to hold the entry's own fields. */
const EDGE = 512;

/** An entry line's own id and time, read without parsing the line. */
function identify(line: Buffer): { id: string; at: number } | undefined {
	const match = HEAD.exec(line.subarray(0, EDGE).toString()) ?? TAIL.exec(line.subarray(-EDGE).toString());
	return match ? { id: match[1]!, at: Date.parse(match[2]!) } : undefined;
}

/**
 * The wanted entries of a Pi transcript, read from its end backwards. Pi appends entries in time order, so the read
 * stops once every wanted entry is found or a line is older than the oldest wanted entry (`wanted` maps an id to its
 * indexed time; an unknown time keeps the read going until the entry is found). A transcript can be larger than V8's
 * longest string, so it is never read whole, and only wanted lines are parsed. `bytes` is how much was read.
 */
export async function readTranscriptEntries(
	file: string,
	wanted: Map<string, number | undefined>,
): Promise<{ found: Map<string, unknown>; bytes: number }> {
	const found = new Map<string, unknown>();
	const remaining = new Map(wanted);
	const oldest = () => {
		let at = Number.POSITIVE_INFINITY;
		for (const time of remaining.values()) at = Math.min(at, time ?? Number.NEGATIVE_INFINITY);
		return at;
	};
	let floor = oldest();
	const handle = await open(file, "r");
	let bytes = 0;
	try {
		let position = (await handle.stat()).size;
		// The start of the line that continues past the bytes read so far, as chunks in file order.
		let carry: Buffer[] = [];
		/** Take one complete line; true once nothing more is wanted. */
		const take = (line: Buffer): boolean => {
			if (!line.length) return false;
			const own = identify(line);
			if (!own) return false;
			if (remaining.has(own.id)) {
				try {
					found.set(own.id, JSON.parse(line.toString()));
				} catch {}
				remaining.delete(own.id);
				if (!remaining.size) return true;
				floor = oldest();
			}
			return own.at < floor;
		};
		while (position > 0 && remaining.size) {
			const length = Math.min(CHUNK_BYTES, position);
			position -= length;
			const chunk = Buffer.allocUnsafe(length);
			await handle.read(chunk, 0, length, position);
			bytes += length;
			let end = chunk.length;
			let newline = chunk.lastIndexOf(10, end - 1);
			if (newline < 0) {
				carry.unshift(chunk);
				continue;
			}
			// The line that ends where the last read began.
			if (take(Buffer.concat([chunk.subarray(newline + 1, end), ...carry]))) return { found, bytes };
			carry = [];
			end = newline;
			for (newline = end > 0 ? chunk.lastIndexOf(10, end - 1) : -1; newline >= 0; ) {
				if (take(chunk.subarray(newline + 1, end))) return { found, bytes };
				end = newline;
				newline = end > 0 ? chunk.lastIndexOf(10, end - 1) : -1;
			}
			carry = [chunk.subarray(0, end)];
		}
		if (remaining.size && carry.length) take(Buffer.concat(carry));
		return { found, bytes };
	} finally {
		await handle.close();
	}
}
