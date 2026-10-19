// PROTOTYPE: the hand-authored places: painted interiors (hall, gallery, wing rooms) and one tiled exterior
// (the lane outside). Walk grids, spots, and doors are written by hand over each painting, in tiles of T px.
import { tileIndex, tilesetCanvas } from "./terrain.js";
import { hash } from "./util.js";

export const T = 48;
const AGENT_LOOKS = ["artificer", "scholar", "scout", "engineer", "mage"];
const look = (s) => (s.coordinator ? "coordinator" : AGENT_LOOKS[hash(s.id) % AGENT_LOOKS.length]);

function painted(key, w, h) {
	return (scene) => scene.add.image(0, 0, key).setOrigin(0).setDisplaySize(w, h).setDepth(0);
}

function wingDoorColumns(n) {
	// The gallery painting has five niches; extra wings repeat its fourth niche section. Pixels are the painting's.
	const s = (14 * T) / 887;
	const copies = Math.max(1, n - 4);
	const centers = [390, 658, 918].map((c) => c * s);
	for (let k = 0; k < copies; k++) centers.push((1177 + k * 260) * s);
	centers.push((1439 + (copies - 1) * 260) * s);
	return { s, copies, centers, width: (1774 + (copies - 1) * 260) * s };
}

export function hall(scene, world) {
	const people = [];
	if (world.coordinator) people.push({ session: world.coordinator, at: [14, 5], look: look(world.coordinator) });
	const commonSpots = [[3, 10], [8, 9], [8, 11], [9, 12], [10, 9]];
	world.common.forEach((s, i) => commonSpots[i] && people.push({ session: s, at: commonSpots[i], face: "left", look: look(s) }));
	return {
		title: "Guild hall",
		tile: T,
		cols: 30,
		rows: 20,
		drawBackdrop: painted("hall", 30 * T, 20 * T),
		blocked: [
			[0, 0, 30, 4], [11, 4, 8, 1], [0, 4, 2, 11], [2, 4, 4, 3], [6, 5, 4, 3], [2, 7, 3, 2], [5, 8, 3, 2], [5, 7, 2, 1],
			[2, 11, 6, 4], [0, 15, 30, 5], [23, 4, 3, 4], [26, 4, 4, 11],
		],
		entries: { start: [15, 12], lane: [15, 14], gallery: [25, 9] },
		hotspots: [
			{ name: "Archway to the wings", rect: [26, 5, 3, 6], standAt: [25, 9], verbs: [{ verb: "Walk-through", run: (sc) => sc.go("gallery", "hall") }] },
			{ name: "Hall doors", rect: [13, 15, 4, 3], standAt: [15, 14], verbs: [{ verb: "Open", run: (sc) => sc.go("lane", "hall") }] },
		],
		people,
	};
}

export function gallery(scene, world) {
	const wings = world.wings;
	const { s, copies, centers, width } = wingDoorColumns(wings.length);
	const cols = Math.ceil(width / T);
	const doors = centers.map((x, i) => ({ x, col: Math.floor(x / T), wing: wings[i] }));
	return {
		title: "Gallery of wings",
		tile: T,
		cols,
		rows: 14,
		drawBackdrop: (sc) => {
			const key = "gallery";
			const tex = sc.textures.get(key);
			const crop = (name, x0, x1) => {
				if (!tex.has(name)) tex.add(name, 0, x0, 0, x1 - x0, 887);
				return name;
			};
			const parts = [[crop("ga", 0, 1047), 0]];
			for (let k = 0; k < copies; k++) parts.push([crop("gs", 1047, 1307), 1047 + k * 260]);
			parts.push([crop("gb", 1307, 1774), 1047 + copies * 260]);
			for (const [frame, x] of parts) sc.add.image(x * s, 0, key, frame).setOrigin(0).setScale(s).setDepth(0);
			for (const d of doors) {
				if (!d.wing) continue;
				const occupied = d.wing.agents.length > 0;
				sc.add.image(d.x, 296, occupied ? "door-closed" : "door-boarded").setOrigin(0.5, 1).setScale(0.36).setDepth(1);
				const banner = sc.add.image(d.x, 36, hash(d.wing.repo) % 2 ? "banner-red" : "banner-cream").setOrigin(0.5, 0).setScale(0.17).setDepth(2);
				sc.add
					.text(d.x, 36 + banner.displayHeight + 4, d.wing.repo, { fontFamily: "Georgia, serif", fontSize: "13px", color: "#f3e2b8", stroke: "#2b1d12", strokeThickness: 4 })
					.setOrigin(0.5, 0)
					.setDepth(3);
				if (occupied) {
					const glow = sc.add.ellipse(d.x, 300, 70, 14, 0xffc06a, 0.35).setDepth(1);
					sc.tweens.add({ targets: glow, alpha: 0.15, yoyo: true, repeat: -1, duration: 1400, ease: "Sine.inOut" });
				}
			}
		},
		blocked: [[0, 0, cols, 7], [0, 12, cols, 2]],
		entries: { start: [2, 8], hall: [2, 8], ...Object.fromEntries(doors.filter((d) => d.wing).map((d) => [`wing:${d.wing.repo}`, [d.col, 7]])) },
		hotspots: [
			{ name: "Archway to the hall", rect: [0, 2, 3, 5], standAt: [1, 7], verbs: [{ verb: "Walk-through", run: (sc) => sc.go("hall", "gallery") }] },
			...doors
				.filter((d) => d.wing)
				.map((d) => ({
					name: `${d.wing.repo} wing`,
					rect: [d.col - 1, 2, 3, 5],
					standAt: [d.col, 7],
					verbs: [
						{ verb: "Enter", run: (sc) => sc.go("wing", "gallery", { repo: d.wing.repo }) },
						...(d.wing.agents.length ? [] : [{ verb: "Examine", run: (sc) => sc.note(`${d.wing.repo}: closed up; nobody works here now.`) }]),
					],
				})),
		],
		people: [],
	};
}

const WING_ROOMS = {
	small: {
		image: "wing-small", cols: 16, rows: 16, banner: [373, 18], door: [7, 13, 3, 3], stand: [8, 12],
		blocked: [[0, 0, 16, 5], [0, 5, 2, 7], [1, 11, 2, 2], [12, 4, 4, 2], [14, 5, 2, 8], [0, 13, 16, 3], [2, 5, 5, 2], [9, 5, 5, 2], [6, 8, 4, 2]],
		spots: [[4, 7], [11, 7], [7, 10]],
	},
	large: {
		image: "wing-large", cols: 30, rows: 20, banner: [728, 30], door: [14, 15, 3, 4], stand: [15, 14],
		blocked: [[0, 0, 30, 5], [0, 5, 3, 15], [27, 5, 3, 15], [0, 15, 30, 5], [4, 6, 5, 2], [10, 6, 5, 2], [16, 6, 5, 2], [21, 6, 5, 2], [11, 9, 8, 3], [3, 11, 6, 2], [22, 11, 5, 2], [9, 12, 6, 2], [16, 12, 5, 2]],
		spots: [[5, 8], [11, 8], [17, 8], [23, 8], [5, 13], [24, 13], [11, 14], [17, 14]],
	},
};

export function wing(scene, world, data) {
	const w = world.wings.find((x) => x.repo === data?.repo) ?? { repo: data?.repo ?? "?", agents: [] };
	const room = WING_ROOMS[w.agents.length > 3 ? "large" : "small"];
	return {
		title: `${w.repo} wing`,
		tile: T,
		cols: room.cols,
		rows: room.rows,
		drawBackdrop: (sc) => {
			painted(room.image, room.cols * T, room.rows * T)(sc);
			const banner = sc.add.image(room.banner[0], room.banner[1], hash(w.repo) % 2 ? "banner-red" : "banner-cream").setOrigin(0.5, 0).setScale(0.22).setDepth(2);
			sc.add
				.text(room.banner[0], room.banner[1] + banner.displayHeight * 0.42, w.repo, { fontFamily: "Georgia, serif", fontSize: "12px", color: hash(w.repo) % 2 ? "#f6e3b4" : "#4a2a14", align: "center", wordWrap: { width: banner.displayWidth * 0.8 } })
				.setOrigin(0.5)
				.setDepth(3);
		},
		blocked: room.blocked,
		entries: { start: room.stand, gallery: room.stand },
		hotspots: [{ name: "Door to the gallery", rect: room.door, standAt: room.stand, verbs: [{ verb: "Open", run: (sc) => sc.go("gallery", `wing:${w.repo}`) }] }],
		people: w.agents.slice(0, room.spots.length).map((s, i) => ({ session: s, at: room.spots[i], pose: "sit", look: look(s) })),
	};
}

export function lane(scene, world) {
	const cols = 26;
	const rows = 17;
	const g = Array.from({ length: rows }, () => new Array(cols).fill(0));
	for (let x = 0; x < cols; x++) for (const y of [12, 13]) g[y][x] = 1;
	for (let y = 9; y < 12; y++) for (const x of [12, 13]) g[y][x] = 1;
	for (let y = 8; y < 10; y++) for (let x = 10; x < 16; x++) g[y][x] = 2;
	const decor = [
		["oak", 3, 4], ["pine", 1, 8], ["blossom", 21, 4], ["oak", 23, 8], ["pine", 19, 15], ["blossom", 4, 15],
		["lamp", 10, 11], ["lamp", 16, 11], ["lamp", 6, 14], ["lamp", 20, 14], ["bench", 7, 11], ["bench", 18, 11],
		["flowerbed", 9, 9], ["flowerbed", 16, 9], ["signpost", 14, 15], ["barrel", 17, 7],
	];
	const independentSpots = [[8, 13], [20, 12], [22, 13]];
	return {
		title: "The lane outside",
		tile: T,
		cols,
		rows,
		drawBackdrop: (sc) => {
			if (!sc.textures.exists("terrain")) sc.textures.addCanvas("terrain", tilesetCanvas());
			const map = sc.make.tilemap({ tileWidth: 32, tileHeight: 32, width: cols, height: rows });
			const set = map.addTilesetImage("terrain", "terrain", 32, 32, 0, 0);
			const layer = map.createBlankLayer("ground", set, 0, 0).setScale(T / 32);
			for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) layer.putTileAt(tileIndex(g, x, y), x, y);
			sc.add.image(13 * T, 8.6 * T, "hq").setOrigin(0.5, 1).setScale(1.5).setDepth(8.6 * T);
			for (const [key, x, y] of decor) sc.add.image((x + 0.5) * T, (y + 0.9) * T, key).setOrigin(0.5, 1).setScale(1.5).setDepth((y + 0.9) * T);
			// Evening, to match the lantern-lit interiors: a dusk wash, then warm pools under the lamps and the hall door.
			sc.add.rectangle(0, 0, cols * T, rows * T, 0x241a4a, 0.42).setOrigin(0).setDepth(50000);
			const glows = decor.filter(([key]) => key === "lamp").map(([, x, y]) => [(x + 0.5) * T, (y - 0.6) * T, 150]);
			glows.push([13 * T, 7.4 * T, 220]);
			if (!sc.textures.exists("glow")) {
				const c = document.createElement("canvas");
				c.width = c.height = 256;
				const ctx = c.getContext("2d");
				const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
				g.addColorStop(0, "rgba(255,200,120,0.9)");
				g.addColorStop(0.4, "rgba(255,170,80,0.35)");
				g.addColorStop(1, "rgba(255,150,60,0)");
				ctx.fillStyle = g;
				ctx.fillRect(0, 0, 256, 256);
				sc.textures.addCanvas("glow", c);
			}
			for (const [x, y, r] of glows) {
				const glow = sc.add.image(x, y, "glow").setDisplaySize(r * 2, r * 2).setAlpha(0.4).setDepth(50001).setBlendMode(Phaser.BlendModes.ADD);
				sc.tweens.add({ targets: glow, alpha: 0.28, yoyo: true, repeat: -1, duration: 1800 + r * 4, ease: "Sine.inOut" });
			}
		},
		blocked: [[8, 1, 10, 7], ...decor.map(([key, x, y]) => (["oak", "blossom"].includes(key) ? [x - 1, y, 3, 1] : [x, y, 1, 1]))],
		entries: { start: [13, 10], hall: [13, 9] },
		hotspots: [{ name: "Guild hall", rect: [12, 6, 2, 2], standAt: [13, 8], verbs: [{ verb: "Enter", run: (sc) => sc.go("hall", "lane") }] }],
		people: world.independent.slice(0, independentSpots.length).map((s, i) => ({ session: s, at: independentSpots[i], look: look(s) })),
	};
}
