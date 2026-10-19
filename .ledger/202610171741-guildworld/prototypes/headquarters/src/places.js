// PROTOTYPE: the hand-authored places: painted interiors (hall, gallery, wing rooms) and one tiled exterior
// (the village square). Walk grids, spots, and doors are written by hand over each painting, in tiles of T px.
// Coordinates are in tiles and may be fractional: blocked areas are [x, y, w, h] traced around furniture over a
// half-tile grid, and spots, entries, and stand points are the feet position of a character.
import { hash } from "./util.js";

export const T = 48;
const AGENT_LOOKS = ["artificer", "scholar", "scout", "engineer", "mage"];
const CHANNEL_LOOKS = ["crier", "merchant", "bard"];
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
	if (world.coordinator) people.push({ session: world.coordinator, at: [14.6, 5.3], look: look(world.coordinator) });
	const commonSpots = [[3.6, 10.4], [8.7, 9.4], [8.6, 11.4], [9.6, 12.6], [10.6, 9.6]];
	world.common.forEach((s, i) => commonSpots[i] && people.push({ session: s, at: commonSpots[i], look: look(s) }));
	return {
		title: "Guild hall",
		tile: T,
		cols: 30,
		rows: 20,
		drawBackdrop: painted("hall", 30 * T, 20 * T),
		blocked: [
			[0, 0, 30, 4], [12.3, 3, 5.6, 2], [9, 3.4, 1.6, 0.8], [0, 4, 1.6, 11], [1.8, 4, 4.4, 3.2], [5, 4, 2.6, 1.7],
			[6.3, 5.8, 3.5, 2.2], [2.4, 7.3, 1.6, 1.7], [4.9, 7.6, 2.1, 1.1], [5.6, 8.4, 2, 1.5], [2.2, 11, 4.8, 3],
			[0, 14.6, 30, 5.4], [23, 4, 3, 4], [26, 4, 4, 11],
		],
		entries: { start: [15, 12.5], square: [15, 14.2], gallery: [25.4, 9] },
		hotspots: [
			{ name: "Archway to the wings", rect: [26.1, 4.5, 1.8, 6.5], standAt: [25.4, 9], verbs: [{ verb: "Walk-through", run: (sc) => sc.go("gallery", "hall") }] },
			{ name: "Hall doors", rect: [13, 15, 4.2, 3.6], standAt: [15, 14.2], verbs: [{ verb: "Open", run: (sc) => sc.go("square", "hall") }] },
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
		entries: { start: [2, 8.5], hall: [2, 8.5], ...Object.fromEntries(doors.filter((d) => d.wing).map((d) => [`wing:${d.wing.repo}`, [d.x / T, 7.5]])) },
		hotspots: [
			{ name: "Archway to the hall", rect: [0.4, 2.5, 1.9, 4.5], standAt: [1.6, 7.5], verbs: [{ verb: "Walk-through", run: (sc) => sc.go("hall", "gallery") }] },
			...doors
				.filter((d) => d.wing)
				.map((d) => ({
					name: `${d.wing.repo} wing`,
					rect: [d.x / T - 0.9, 2.7, 1.8, 3.6],
					standAt: [d.x / T, 7.5],
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
		image: "wing-small", cols: 16, rows: 16, banner: [384, 18], door: [7.1, 12.9, 1.8, 1.8], stand: [8, 12.2],
		blocked: [[0, 0, 16, 4.3], [0, 4, 2.2, 1], [0, 4, 1.6, 8.5], [0, 11.5, 2.2, 1], [13.6, 3, 2.4, 2.2], [14.2, 6.5, 1.8, 5.3], [14.6, 4, 1.4, 8.5], [13.7, 11.6, 2.3, 1], [0, 12.6, 7, 3.4], [9, 12.6, 7, 3.4], [7, 14.6, 2, 1.4], [2.6, 5.4, 3.5, 1.3], [10, 5.4, 3.5, 1.3], [6.1, 8.4, 3.7, 1.3]],
		spots: [[4.2, 7.1], [11.7, 7.1], [7.4, 10.2]],
	},
	large: {
		image: "wing-large", cols: 30, rows: 20, banner: [728, 30], door: [14.2, 17, 1.8, 2.5], stand: [15.1, 15.8],
		blocked: [
			[0, 0, 30, 5], [0, 4, 1.5, 12], [1.5, 4.5, 2, 1.5], [26.5, 4, 3.5, 3], [29, 4, 1, 14], [27.5, 13, 2.5, 5],
			[0, 15.6, 14.1, 4.4], [16.2, 15.6, 13.8, 4.4], [14, 19.5, 2.3, 0.5],
			[4.5, 6, 4, 1.5], [10, 6, 4.3, 1.5], [15.9, 6, 4.1, 1.5], [21.4, 6, 4, 1.6], [11.8, 9, 6.9, 2.5],
			[3.3, 10.8, 4.7, 1.6], [22, 10.6, 4.3, 1.8], [9.6, 12.6, 4.4, 1.6], [16, 12.6, 4.8, 1.7],
		],
		spots: [[5.9, 8.1], [11.3, 8.1], [17.3, 8.1], [23.1, 8.1], [5.2, 13.1], [24.2, 13.1], [11.2, 15], [17.6, 15]],
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

const notBuilt = (place) => ({ verb: "Enter", run: (sc) => sc.note(`${place}: not built yet in this prototype.`) });

/** Glows drawn over painted lanterns: warm light the painting leaves unlit so it can flicker. */
function glow(sc, x, y, r) {
	if (!sc.textures.exists("glow")) {
		const c = document.createElement("canvas");
		c.width = c.height = 256;
		const ctx = c.getContext("2d");
		const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
		g.addColorStop(0, "rgba(255,210,130,0.95)");
		g.addColorStop(0.35, "rgba(255,170,80,0.35)");
		g.addColorStop(1, "rgba(255,150,60,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 256, 256);
		sc.textures.addCanvas("glow", c);
	}
	const image = sc.add.image(x * T, y * T, "glow").setDisplaySize(r * 2 * T, r * 2 * T).setAlpha(0.9).setDepth(50001).setBlendMode(Phaser.BlendModes.ADD);
	sc.tweens.add({ targets: image, alpha: 0.65, yoyo: true, repeat: -1, duration: 900 + Math.random() * 900, ease: "Sine.inOut" });
}

/** The fountain's water: the painting leaves the basin dry so the water can move. */
function fountainWater(sc) {
	const surface = sc.add.ellipse(15.5 * T, 10.55 * T, 4.9 * T, 1.75 * T, 0x3d7fb0, 0.78).setDepth(10.9 * T);
	const shine = sc.add.ellipse(15.1 * T, 10.35 * T, 2.6 * T, 0.5 * T, 0xbfe6ff, 0.35).setDepth(10.91 * T);
	sc.tweens.add({ targets: shine, x: 15.9 * T, alpha: 0.15, yoyo: true, repeat: -1, duration: 2300, ease: "Sine.inOut" });
	sc.tweens.add({ targets: surface, alpha: 0.4, scaleX: 1.015, yoyo: true, repeat: -1, duration: 1600, ease: "Sine.inOut" });
	if (!sc.textures.exists("drop")) {
		const g = sc.make.graphics({ x: 0, y: 0 }, false);
		g.fillStyle(0xcfeaff, 1).fillCircle(3, 3, 3);
		g.generateTexture("drop", 6, 6);
		g.destroy();
	}
	sc.add
		.particles(15.45 * T, 8.35 * T, "drop", {
			speedX: { min: -70, max: 70 },
			speedY: { min: -170, max: -110 },
			gravityY: 320,
			lifespan: 900,
			scale: { start: 0.9, end: 0.4 },
			alpha: { start: 0.9, end: 0.2 },
			frequency: 28,
			quantity: 2,
		})
		.setDepth(10.95 * T);
}

export function square(scene, world) {
	const lamps = [[10.9, 6.2], [10.0, 11.6], [20.5, 6.5], [21.6, 11.9]];
	const channelSpots = [[7, 9.6], [23, 9.6], [18.6, 14], [12.5, 13.9]];
	const independentSpots = [[25.4, 12.2], [5.8, 11.2], [24.5, 7.4]];
	return {
		title: "The village square",
		tile: T,
		cols: 32,
		rows: 21,
		drawBackdrop: (sc) => {
			painted("square", 32 * T, 21 * T)(sc);
			fountainWater(sc);
			for (const [x, y] of lamps) glow(sc, x, y, 1.6);
		},
		blocked: [
			[0, 0, 25.4, 5.6], [25.4, 0, 3.4, 4.6], [28.8, 0, 3.2, 5.6], [0, 5.6, 5.3, 3.4], [4.4, 7.4, 1.2, 1.9],
			[12.2, 9.3, 6.9, 3.3], [13, 8.8, 5, 0.6], [13, 12.5, 5.2, 0.4],
			[10.6, 7.7, 0.6, 0.6], [9.7, 13.1, 0.6, 0.6], [20.2, 7.2, 0.6, 0.6], [21.3, 13.1, 0.6, 0.6],
			[0, 10.6, 5.2, 4.6], [5, 13.2, 4, 1.4], [21.8, 13.6, 3.2, 1],
			[27.2, 5.6, 4.8, 6], [27.2, 11.6, 2.3, 2], [30.7, 11.6, 1.3, 2], [26.5, 6, 1, 2.6],
			[0, 14.6, 13.6, 6.4], [19.6, 14.5, 7.6, 6.5], [18.6, 16.2, 1, 1.4], [31.3, 14.2, 0.7, 6.8], [29.5, 17.3, 1.2, 1.4],
		],
		entries: { start: [15.6, 6.8], hall: [15.6, 6.8] },
		hotspots: [
			{ name: "Guild hall doors", rect: [14.6, 2.8, 2.1, 2.3], standAt: [15.6, 6.2], verbs: [{ verb: "Enter", run: (sc) => sc.go("hall", "square") }] },
			{ name: "Forge", rect: [7.7, 4, 2.2, 1.9], standAt: [8.8, 6.4], verbs: [notBuilt("The forge (GitHub)")] },
			{ name: "Library", rect: [20.9, 3.6, 1.6, 1.5], standAt: [21.7, 6], verbs: [notBuilt("The library (Confluence)")] },
			{ name: "Quest office", rect: [1.9, 7, 1.3, 2], standAt: [2.6, 9.9], verbs: [notBuilt("The quest office (Jira)")] },
			{ name: "Inn", rect: [29.5, 11.6, 1.2, 1.8], standAt: [30.1, 14.1], verbs: [notBuilt("The inn (dormant agents)")] },
			{ name: "Rookery", rect: [26.5, 3.6, 1, 1], standAt: [27, 5.1], verbs: [notBuilt("The rookery (mail)")] },
		],
		props: [
			{
				key: "cat", at: [28.4, 14.3], frame: 0, name: "Cat",
				verbs: [
					{ verb: "Pet", run: (sc, sprite) => sc.purr(sprite) },
					{ verb: "Examine", run: (sc) => sc.note("A grey tabby who owns the square.") },
				],
			},
		],
		people: [
			...world.channels.slice(0, channelSpots.length).map((s, i) => ({ session: s, at: channelSpots[i], look: CHANNEL_LOOKS[i % CHANNEL_LOOKS.length] })),
			...world.independent.slice(0, independentSpots.length).map((s, i) => ({ session: s, at: independentSpots[i], look: look(s) })),
		],
	};
}
