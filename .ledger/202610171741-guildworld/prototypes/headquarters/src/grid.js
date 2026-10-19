// PROTOTYPE: a walk grid over a painted scene, with RuneScape-style 8-direction tile paths (no corner cutting).
export class Grid {
	constructor(w, h) {
		this.w = w;
		this.h = h;
		this.blocked = new Uint8Array(w * h);
	}

	block([x, y, w, h], value = 1) {
		for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.inside(xx, yy)) this.blocked[yy * this.w + xx] = value;
	}

	inside(x, y) {
		return x >= 0 && y >= 0 && x < this.w && y < this.h;
	}

	free(x, y) {
		return this.inside(x, y) && !this.blocked[y * this.w + x];
	}

	/** Shortest path of tiles from start to goal (both inclusive), or null; diagonal steps need both sides free. */
	path([sx, sy], [gx, gy]) {
		if (!this.free(gx, gy)) return null;
		const key = (x, y) => y * this.w + x;
		const cost = new Map([[key(sx, sy), 0]]);
		const from = new Map();
		const open = [[0, sx, sy]];
		const h = (x, y) => Math.max(Math.abs(x - gx), Math.abs(y - gy)) + 0.4 * Math.min(Math.abs(x - gx), Math.abs(y - gy));
		while (open.length) {
			open.sort((a, b) => a[0] - b[0]);
			const [, x, y] = open.shift();
			if (x === gx && y === gy) {
				const out = [[x, y]];
				let k = key(x, y);
				while (from.has(k)) {
					k = from.get(k);
					out.unshift([k % this.w, Math.floor(k / this.w)]);
				}
				return out;
			}
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
				const nx = x + dx;
				const ny = y + dy;
				if (!this.free(nx, ny)) continue;
				if (dx && dy && (!this.free(x + dx, y) || !this.free(x, y + dy))) continue;
				const c = cost.get(key(x, y)) + (dx && dy ? 1.4 : 1);
				if (c < (cost.get(key(nx, ny)) ?? Number.POSITIVE_INFINITY)) {
					cost.set(key(nx, ny), c);
					from.set(key(nx, ny), key(x, y));
					open.push([c + h(nx, ny), nx, ny]);
				}
			}
		}
		return null;
	}

	/** The free tile next to (x, y), or (x, y) itself, that is nearest to `from`: where you stand to interact. */
	besideNearest([x, y], from) {
		let best = null;
		for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]]) {
			const p = [x + dx, y + dy];
			if (!this.free(...p)) continue;
			const d = Math.hypot(p[0] - from[0], p[1] - from[1]);
			if (!best || d < best.d) best = { p, d };
		}
		return best?.p ?? null;
	}
}
