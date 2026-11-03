import { open } from "node:fs/promises";

const CHUNK_BYTES = 1 << 20;

const HEAD = /^\{"type":"[^"]*","id":"([^"]+)",(?:"parentId":(?:null|"[^"]*"),)?"timestamp":"([^"]+)"/;
const TAIL = /"id":"([^"]+)",(?:"parentId":(?:null|"[^"]*"),)?"timestamp":"([^"]+)"\}\s*$/;
const EDGE = 512;

function identify(line: Buffer): { id: string; at: number } | undefined {
	const match = HEAD.exec(line.subarray(0, EDGE).toString()) ?? TAIL.exec(line.subarray(-EDGE).toString());
	return match ? { id: match[1]!, at: Date.parse(match[2]!) } : undefined;
}

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
		let carry: Buffer[] = [];
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
