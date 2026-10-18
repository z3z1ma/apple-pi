// PROTOTYPE: a pixel tileset drawn in code (grass, cobbled road, plaza flagstones) with edge variants,
// so roads and the plaza blend into grass without hand-placed transition tiles.
import { rng } from "./layout.js";

const T = 32;
export const GRASS = [0, 1, 2, 3];
export const ROAD_BASE = 4; // + mask (N=1, E=2, S=4, W=8: neighbour is grass)
export const PLAZA_BASE = 20;
const COUNT = 36;

function px(ctx, x, y, color) {
	ctx.fillStyle = color;
	ctx.fillRect(x, y, 1, 1);
}

function grass(ctx, ox, variant) {
	const r = rng(1000 + variant * 77);
	const tones = ["#5b8a3c", "#64944a", "#527f36", "#6fa152"];
	ctx.fillStyle = tones[0];
	ctx.fillRect(ox, 0, T, T);
	for (let i = 0; i < 140; i++) px(ctx, ox + Math.floor(r() * T), Math.floor(r() * T), tones[1 + Math.floor(r() * 3)]);
	for (let i = 0; i < 6; i++) {
		const x = ox + Math.floor(r() * (T - 2));
		const y = Math.floor(r() * (T - 3)) + 2;
		px(ctx, x, y, "#3f6b2a");
		px(ctx, x + 1, y - 1, "#7fb35d");
		px(ctx, x + 1, y - 2, "#8cc26a");
	}
	if (variant === 3) {
		const flowers = ["#f4e3a1", "#e9a6c8", "#c9b8f0", "#ffffff"];
		for (let i = 0; i < 4; i++) {
			const x = ox + 3 + Math.floor(r() * (T - 6));
			const y = 3 + Math.floor(r() * (T - 6));
			const c = flowers[Math.floor(r() * flowers.length)];
			px(ctx, x, y, c);
			px(ctx, x - 1, y, c);
			px(ctx, x + 1, y, c);
			px(ctx, x, y - 1, c);
			px(ctx, x, y + 1, "#3f6b2a");
		}
	}
}

function stones(ctx, ox, seed, base, light, dark, size) {
	const r = rng(seed);
	ctx.fillStyle = dark;
	ctx.fillRect(ox, 0, T, T);
	for (let y = 0; y < T; y += size) {
		const shift = (y / size) % 2 ? Math.floor(size / 2) : 0;
		for (let x = -shift; x < T; x += size) {
			const w = size - 1 - Math.floor(r() * 2);
			const h = size - 1 - Math.floor(r() * 2);
			const x0 = Math.max(0, x);
			const x1 = Math.min(T, x + w);
			if (x1 <= x0) continue;
			ctx.fillStyle = r() < 0.25 ? light : base;
			ctx.fillRect(ox + x0, y, x1 - x0, Math.min(h, T - y));
			ctx.fillStyle = light;
			ctx.fillRect(ox + x0, y, x1 - x0, 1);
		}
	}
}

function edges(ctx, ox, mask, grassSeed) {
	const r = rng(grassSeed);
	const tones = ["#5b8a3c", "#64944a", "#527f36"];
	const border = "#4a3a2a";
	const side = (bit, cell) => {
		if (!(mask & bit)) return;
		for (let i = 0; i < T; i++) {
			const depth = 2 + Math.floor(r() * 3);
			for (let d = 0; d < depth; d++) {
				const [x, y] = cell(i, d);
				px(ctx, ox + x, y, d === depth - 1 ? border : tones[Math.floor(r() * 3)]);
			}
		}
	};
	side(1, (i, d) => [i, d]);
	side(2, (i, d) => [T - 1 - d, i]);
	side(4, (i, d) => [i, T - 1 - d]);
	side(8, (i, d) => [d, i]);
}

export function tilesetCanvas() {
	const canvas = document.createElement("canvas");
	canvas.width = T * COUNT;
	canvas.height = T;
	const ctx = canvas.getContext("2d");
	for (const v of GRASS) grass(ctx, v * T, v);
	for (let m = 0; m < 16; m++) {
		stones(ctx, (ROAD_BASE + m) * T, 31 + m, "#a08a6c", "#c2ab88", "#6e5a45", 6);
		edges(ctx, (ROAD_BASE + m) * T, m, 500 + m);
		stones(ctx, (PLAZA_BASE + m) * T, 91 + m, "#b7ab98", "#d8ccb6", "#7d705f", 8);
		edges(ctx, (PLAZA_BASE + m) * T, m, 700 + m);
	}
	return canvas;
}

export function tileIndex(g, x, y) {
	const v = g[y][x];
	if (v === 0) return GRASS[(x * 7 + y * 13 + ((x * y) % 5)) % 11 < 9 ? (x + y) % 3 : 3];
	const isGrass = (xx, yy) => (g[yy]?.[xx] ?? 0) === 0;
	const mask = (isGrass(x, y - 1) ? 1 : 0) | (isGrass(x + 1, y) ? 2 : 0) | (isGrass(x, y + 1) ? 4 : 0) | (isGrass(x - 1, y) ? 8 : 0);
	return (v === 1 ? ROAD_BASE : PLAZA_BASE) + mask;
}
