// The theme packs on disk: list them for Settings and check them (`checkPack`) with a reader over the file system.
// PNGs are read here without an image library: their size from the header, and for character sheets their alpha
// channel, decoded from the IDAT stream (8-bit, non-interlaced, which is what the art pipeline writes).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { inflateSync } from "node:zlib";
import { checkPack, type PackImage, type PackProblem, type PackReader } from "../theme-pack.js";
import type { ThemeChoice } from "../world.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo each scanline's PNG filter, handing every row of samples to `row` in order. */
function unfilter(
	raw: Buffer,
	width: number,
	height: number,
	channels: number,
	row: (y: number, line: Uint8Array) => void,
) {
	const stride = width * channels;
	const current = new Uint8Array(stride);
	let previous = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let i = 0; i < stride; i++) {
			const left = i >= channels ? current[i - channels] : 0;
			const up = previous[i];
			const corner = i >= channels ? previous[i - channels] : 0;
			const predicted =
				filter === 1
					? left
					: filter === 2
						? up
						: filter === 3
							? (left + up) >> 1
							: filter === 4
								? paeth(left, up, corner)
								: 0;
			current[i] = line[i] + predicted;
		}
		row(y, current);
		previous = Uint8Array.from(current);
	}
}

/** A PNG's size, and with `pixels` its alpha channel; undefined when the file is not a PNG it can read. */
export function readPng(data: Buffer, pixels = false): PackImage | undefined {
	if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE) || data.toString("latin1", 12, 16) !== "IHDR")
		return undefined;
	const width = data.readUInt32BE(16);
	const height = data.readUInt32BE(20);
	if (!pixels) return { width, height };
	const depth = data[24];
	const colour = data[25];
	const interlaced = data[28] !== 0;
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
	if (depth !== 8 || interlaced || channels === undefined) return undefined;
	const idat: Buffer[] = [];
	let transparency: Buffer | undefined;
	for (let at = 8; at + 8 <= data.length; ) {
		const length = data.readUInt32BE(at);
		const type = data.toString("latin1", at + 4, at + 8);
		const body = data.subarray(at + 8, at + 8 + length);
		if (type === "IDAT") idat.push(body);
		if (type === "tRNS") transparency = body;
		if (type === "IEND") break;
		at += 12 + length;
	}
	let raw: Buffer;
	try {
		raw = inflateSync(Buffer.concat(idat));
	} catch {
		return undefined;
	}
	const stride = width * channels;
	if (raw.length < height * (stride + 1)) return undefined;
	const alpha = new Uint8Array(width * height);
	unfilter(raw, width, height, channels, (y, line) => {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (colour === 6) alpha[index] = line[x * 4 + 3];
			else if (colour === 4) alpha[index] = line[x * 2 + 1];
			else if (colour === 3) alpha[index] = transparency?.[line[x]] ?? 255;
			else alpha[index] = 255;
		}
	});
	return { width, height, alpha };
}

/** A reader over a pack's directory: paths stay inside it. */
export function packReader(dir: string): PackReader {
	const file = (path: string): string | undefined => {
		const full = normalize(join(dir, path));
		if (!full.startsWith(normalize(dir) + sep) || !existsSync(full) || !statSync(full).isFile()) return undefined;
		return full;
	};
	return {
		async text(path) {
			const full = file(path);
			return full ? readFileSync(full, "utf8") : undefined;
		},
		async image(path, pixels) {
			const full = file(path);
			return full ? readPng(readFileSync(full), pixels) : undefined;
		},
	};
}

/** Check the pack in `dir`, named by its directory. */
export function checkThemePack(dir: string, options?: { pixels?: boolean }): Promise<PackProblem[]> {
	const id = normalize(dir).split(sep).filter(Boolean).pop() ?? "";
	return checkPack(packReader(dir), id, options);
}

/** The window's colour when no pack's backdrop can be read: a neutral dark near every theme's own. */
export const NEUTRAL_BACKDROP = "#121216";

/**
 * The colour the window shows before the page draws (and around it while it resizes): the backdrop (`world.backdrop`,
 * a `#rrggbb` colour) of the theme `id`, else of the pack the world opens in by default, else a neutral dark.
 */
export function themeBackdrop(themesDir: string, id: string | null | undefined): string {
	for (const each of [id, "fantasy"]) {
		if (!each || !/^[a-z0-9][a-z0-9-]*$/.test(each)) continue;
		try {
			const manifest = JSON.parse(readFileSync(join(themesDir, each, "theme.json"), "utf8")) as {
				world?: { backdrop?: unknown };
			};
			const backdrop = manifest.world?.backdrop;
			if (typeof backdrop === "string" && /^#[0-9a-f]{6}$/i.test(backdrop)) return backdrop;
		} catch {}
	}
	return NEUTRAL_BACKDROP;
}

/** Every pack under `themesDir` (a directory with a theme.json), checked, in name order with fantasy first. */
export async function listThemes(themesDir: string, options?: { pixels?: boolean }): Promise<ThemeChoice[]> {
	const ids = existsSync(themesDir)
		? readdirSync(themesDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && existsSync(join(themesDir, entry.name, "theme.json")))
				.map((entry) => entry.name)
				.sort((a, b) => (a === "fantasy" ? -1 : b === "fantasy" ? 1 : a.localeCompare(b)))
		: [];
	return Promise.all(
		ids.map(async (id) => {
			const problems = await checkThemePack(join(themesDir, id), options);
			let name = id;
			let description: string | null = null;
			try {
				const manifest = JSON.parse(readFileSync(join(themesDir, id, "theme.json"), "utf8")) as Record<string, unknown>;
				if (typeof manifest.name === "string") name = manifest.name;
				if (typeof manifest.description === "string") description = manifest.description;
			} catch {}
			return { id, name, description, problems };
		}),
	);
}
