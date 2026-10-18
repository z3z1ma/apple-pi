// PROTOTYPE: town layout in tile units (1 tile = 32 px). Districts, lots, roads, and the remembered lot memory.

export const W = 128;
export const H = 96;
export const PLAZA = { x: 64, y: 48, r: 7 };

// Coordinator district slots: the HQ door faces the end of an avenue; wings extend along the street.
export const SLOTS = [
	{ name: "north", hq: { x: 64, y: 29 }, street: { x0: 36, x1: 92, y: 29 } },
	{ name: "east", hq: { x: 108, y: 47 }, street: { x0: 71, x1: 125, y: 47 } },
	{ name: "west", hq: { x: 20, y: 47 }, street: { x0: 3, x1: 57, y: 47 } },
];

// Commons: rows of lots along streets south of the plaza, filled outward from the south avenue.
const COMMON_ROWS = [70, 79, 88];
const LOT_X = [69, 59, 75, 53, 81, 47, 87, 41, 93, 35];
export const COMMON_LOTS = COMMON_ROWS.flatMap((y) => LOT_X.map((x) => ({ x, y })));

// Hubs: bottom-centre of each building in tiles. Slack is the plaza itself.
export const HUBS = [
	{ key: "hub-confluence", system: "Confluence", fantasy: "Library", x: 52, y: 44 },
	{ key: "hub-github", system: "GitHub", fantasy: "Forge", x: 76, y: 44 },
	{ key: "hub-jira", system: "Jira", fantasy: "Quest Board", x: 53, y: 59 },
];

export function wingOffset(index) {
	// 0: first right, 1: first left, 2: second right ... in tiles from the HQ centre.
	const side = index % 2 === 0 ? 1 : -1;
	const step = Math.floor(index / 2);
	return side * (5.6 + step * 2.8);
}

const KEY = "agent-world-prototype-layout";
export function loadMemory() {
	try {
		return JSON.parse(localStorage.getItem(KEY)) ?? { districts: {}, wings: {}, lots: {} };
	} catch {
		return { districts: {}, wings: {}, lots: {} };
	}
}
export function saveMemory(memory) {
	localStorage.setItem(KEY, JSON.stringify(memory));
}
export function clearMemory() {
	localStorage.removeItem(KEY);
}

// Give each present key a stable index: keep its remembered index when free; otherwise the lowest index
// that no present key holds, preferring indexes no absent key remembers.
export function assign(table, presentKeys, capacity) {
	const taken = new Set();
	const result = {};
	for (const key of presentKeys) {
		const idx = table[key];
		if (idx !== undefined && idx < capacity && !taken.has(idx)) {
			result[key] = idx;
			taken.add(idx);
		}
	}
	const remembered = new Set(Object.values(table));
	for (const key of presentKeys) {
		if (result[key] !== undefined) continue;
		let idx = -1;
		for (let i = 0; i < capacity; i++) {
			if (!taken.has(i) && !remembered.has(i)) {
				idx = i;
				break;
			}
		}
		if (idx < 0) for (let i = 0; i < capacity; i++) if (!taken.has(i)) { idx = i; break; }
		if (idx < 0) continue;
		result[key] = idx;
		taken.add(idx);
		table[key] = idx;
	}
	return result;
}

export function hash(text) {
	let h = 2166136261;
	for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}

export function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
}

// Ground: 0 grass, 1 road, 2 plaza.
export function ground() {
	const g = Array.from({ length: H }, () => new Array(W).fill(0));
	const road = (x0, y0, x1, y1) => {
		for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (g[y]?.[x] !== undefined && g[y][x] === 0) g[y][x] = 1;
	};
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - PLAZA.x + 0.5) ** 2 + (y - PLAZA.y + 0.5) ** 2 <= PLAZA.r ** 2) g[y][x] = 2;
	road(63, 29, 64, PLAZA.y); // north avenue
	road(63, PLAZA.y, 64, COMMON_ROWS.at(-1) + 1); // south avenue
	road(PLAZA.x, 47, 125, 48); // east avenue
	road(3, 47, PLAZA.x, 48); // west avenue
	for (const s of SLOTS) road(s.street.x0, s.street.y, s.street.x1, s.street.y + 1);
	for (const y of COMMON_ROWS) road(32, y, 96, y + 1);
	for (const h of HUBS) road(h.x - 1, h.y, h.x, h.y + 2);
	road(53, 60, 63, 61); // Quest Board to the south avenue
	return g;
}
