// PROTOTYPE: the Agent World town scene (Phaser 4). Places and characters follow the world state;
// motion and ambience are decorative, status and names are the state's values.
import { assign, COMMON_LOTS, ground, H, hash, HUBS, loadMemory, PLAZA, rng, saveMemory, SLOTS, W, wingOffset } from "./layout.js";
import { places } from "./state.js";
import { tileIndex, tilesetCanvas } from "./terrain.js";

const T = 32;
const HOUSES = ["cottage-1", "cottage-2", "cottage-3", "cottage-4", "house-1", "house-2", "house-3"];
const WINGS = ["wing-1", "wing-2", "wing-3", "wing-4"];
const LOOKS = ["char-a", "char-b", "char-c", "char-d"];
const OVERLAY = 100000;
const DIRS = ["down", "left", "right", "up"];

function canvasTexture(scene, key, w, h, draw) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	draw(c.getContext("2d"));
	scene.textures.addCanvas(key, c);
}

export class TownScene extends Phaser.Scene {
	constructor() {
		super("town");
		this.placeObjs = new Map();
		this.chars = new Map();
		this.glows = [];
		this.evening = true;
	}

	preload() {
		const A = window.ASSETS;
		for (const name of Object.keys(A.images)) this.load.image(name, `assets/${name}.png`);
		for (const [name, [fw, fh]] of Object.entries(A.walkers)) this.load.spritesheet(name, `assets/${name}.png`, { frameWidth: fw, frameHeight: fh });
	}

	create() {
		this.memory = loadMemory();
		this.makeTextures();
		this.makeGround();
		this.makeLandmarks();
		this.makeDecor();
		this.makeAmbience();
		for (const look of [...LOOKS, "char-coord"])
			DIRS.forEach((dir, row) => this.anims.create({ key: `${look}-${dir}`, frames: this.anims.generateFrameNumbers(look, { start: row * 4, end: row * 4 + 3 }), frameRate: 7, repeat: -1 }));
		this.setupCamera();
		this.ready = true;
		if (this.pending) this.apply(this.pending);
		window.dispatchEvent(new Event("town-ready"));
	}

	makeTextures() {
		canvasTexture(this, "glow", 128, 128, (ctx) => {
			const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
			g.addColorStop(0, "rgba(255,214,140,0.95)");
			g.addColorStop(0.35, "rgba(255,180,90,0.45)");
			g.addColorStop(1, "rgba(255,160,60,0)");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, 128, 128);
		});
		canvasTexture(this, "icon-busy", 20, 12, (ctx) => {
			ctx.fillStyle = "#f3e9d2";
			ctx.beginPath();
			ctx.roundRect(0, 0, 20, 12, 6);
			ctx.fill();
			ctx.fillStyle = "#2b2238";
			ctx.beginPath();
			ctx.roundRect(1, 1, 18, 10, 5);
			ctx.fill();
			ctx.fillStyle = "#f3e9d2";
			for (const x of [5, 10, 15]) ctx.fillRect(x - 1, 5, 2, 2);
		});
		canvasTexture(this, "icon-waiting", 16, 16, (ctx) => {
			ctx.fillStyle = "#2b2238";
			ctx.beginPath();
			ctx.moveTo(8, 0);
			ctx.lineTo(16, 8);
			ctx.lineTo(8, 16);
			ctx.lineTo(0, 8);
			ctx.fill();
			ctx.fillStyle = "#f2c14e";
			ctx.beginPath();
			ctx.moveTo(8, 2);
			ctx.lineTo(14, 8);
			ctx.lineTo(8, 14);
			ctx.lineTo(2, 8);
			ctx.fill();
			ctx.fillStyle = "#2b2238";
			ctx.fillRect(7, 4, 2, 5);
			ctx.fillRect(7, 10, 2, 2);
		});
		canvasTexture(this, "icon-idle", 14, 14, (ctx) => {
			ctx.fillStyle = "#2b2238";
			ctx.beginPath();
			ctx.arc(7, 7, 7, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#cfc6f2";
			ctx.beginPath();
			ctx.arc(7, 7, 5, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#2b2238";
			ctx.beginPath();
			ctx.arc(9, 5.5, 4.2, 0, Math.PI * 2);
			ctx.fill();
		});
		for (const [key, color] of [["fx-edit", "#ffb347"], ["fx-read", "#fff4d6"], ["fx-bash", "#8fe39a"], ["dust", "#d9c7a8"]])
			canvasTexture(this, key, 3, 3, (ctx) => {
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 3, 3);
			});
	}

	makeGround() {
		this.ground = ground();
		this.textures.addCanvas("tiles", tilesetCanvas());
		const data = this.ground.map((row, y) => row.map((_, x) => tileIndex(this.ground, x, y)));
		const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
		const tiles = map.addTilesetImage("tiles", "tiles", T, T, 0, 0);
		map.createLayer(0, tiles, 0, 0).setDepth(-10);
	}

	put(key, tx, ty, depthBias = 0) {
		const img = this.add.image(tx * T, ty * T, key).setOrigin(0.5, 1);
		img.setDepth(ty * T + depthBias);
		return img;
	}

	label(text, x, y, sub) {
		const t = this.add.text(x, y, sub ? `${text}\n${sub}` : text, { fontFamily: "Georgia, serif", fontSize: "7px", color: "#fdf3dc", align: "center", backgroundColor: "rgba(43,34,56,0.82)", padding: { x: 3, y: 1 }, resolution: 6 });
		t.setOrigin(0.5, 0).setDepth(OVERLAY + 3);
		return t;
	}

	makeLandmarks() {
		// Town Square (Slack hub): the plaza itself, with the fountain and market stalls.
		this.put("fountain", PLAZA.x, PLAZA.y + 2);
		this.put("stall-1", PLAZA.x, PLAZA.y - 3.2);
		this.put("stall-2", PLAZA.x - 4.6, PLAZA.y + 4.2);
		this.put("stall-3", PLAZA.x + 4.6, PLAZA.y + 4.2);
		this.light(PLAZA.x * T, (PLAZA.y - 1) * T, 3.2, 0.5);
		this.hubLabels = [this.label("Town Square", PLAZA.x * T, (PLAZA.y + 2.2) * T, "Slack")];
		for (const h of HUBS) {
			const img = this.put(h.key, h.x, h.y);
			img.setInteractive({ useHandCursor: true });
			img.on("pointerup", () => this.clicked() && this.inspectPlace({ kind: "hub", title: h.fantasy, system: h.system, x: h.x, y: h.y }));
			this.light(h.x * T, (h.y - 2.5) * T, img.width / 70, 0.55);
			this.hubLabels.push(this.label(h.fantasy, h.x * T, h.y * T + 4, h.system));
		}
		this.forgeSmoke = { x: (HUBS[1].x + 1.6) * T, y: (HUBS[1].y - 6.6) * T };
		this.time.addEvent({ delay: 900, loop: true, callback: () => this.puff(this.forgeSmoke.x, this.forgeSmoke.y) });
	}

	reserved() {
		const res = Array.from({ length: H }, () => new Array(W).fill(false));
		const block = (x0, y0, x1, y1) => {
			for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) res[y][x] = true;
		};
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.ground[y][x] !== 0) block(x - 1, y - 1, x + 1, y + 1);
		for (const s of SLOTS) block(s.street.x0, s.street.y - 9, s.street.x1, s.street.y);
		for (const lot of COMMON_LOTS) block(lot.x - 3, lot.y - 6, lot.x + 3, lot.y);
		for (const h of HUBS) block(h.x - 5, h.y - 9, h.x + 5, h.y + 1);
		block(PLAZA.x - 9, PLAZA.y - 9, PLAZA.x + 9, PLAZA.y + 7);
		return res;
	}

	makeDecor() {
		const res = this.reserved();
		const r = rng(4242);
		const trees = ["oak", "oak", "pine", "pine", "blossom", "bush"];
		for (let y = 3; y < H; y += 1)
			for (let x = 1; x < W - 1; x += 1) {
				if (res[y][x]) continue;
				const edge = Math.min(x, y, W - 1 - x, H - 1 - y) < 5;
				if (r() < (edge ? 0.22 : 0.028)) {
					this.put(trees[Math.floor(r() * trees.length)], x + r() * 0.6, y + 1);
					for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (res[yy]) res[yy][xx] = true;
				}
			}
		// Lamps along the avenues and around the plaza, each a light source in the evening.
		const lamp = (x, y) => {
			this.put("lamp", x, y);
			this.light(x * T, (y - 1.2) * T, 1.1, 0.75);
		};
		for (let y = 32; y < PLAZA.y - PLAZA.r; y += 5) lamp(61.5, y);
		for (let y = PLAZA.y + PLAZA.r + 2; y < 92; y += 6) lamp(66.5, y);
		for (let x = 74; x < 124; x += 7) lamp(x, 50.6);
		for (let x = 6; x < 56; x += 7) lamp(x, 50.6);
		for (let a = 0; a < 8; a++) {
			const ang = (a / 8) * Math.PI * 2 + Math.PI / 8;
			lamp(PLAZA.x + Math.cos(ang) * (PLAZA.r + 0.6), PLAZA.y + Math.sin(ang) * (PLAZA.r + 0.6) + 0.5);
		}
		for (const [x, y] of [[PLAZA.x - 3, PLAZA.y - 0.5], [PLAZA.x + 3, PLAZA.y - 0.5]]) this.put("bench", x, y);
		this.put("signpost", 61.8, 41.5);
		this.put("well", 85, 62);
		this.put("flowerbed", 49, 45.4);
		this.put("flowerbed", 79.5, 45.4);
		this.put("barrel", 72.6, 44.4);
		this.put("crates", 49.3, 60);
	}

	light(x, y, scale, alpha) {
		const l = this.add.image(x, y, "glow").setBlendMode(Phaser.BlendModes.ADD).setDepth(OVERLAY + 1).setScale(scale).setAlpha(alpha);
		l.baseAlpha = alpha;
		this.glows.push(l);
		this.tweens.add({ targets: l, alpha: alpha * 0.82, duration: 900 + Math.random() * 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
		return l;
	}

	makeAmbience() {
		this.dusk = this.add.rectangle(0, 0, W * T, H * T, 0xa99fd6).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(OVERLAY);
	}

	setEvening(on) {
		this.evening = on;
		this.dusk.setVisible(on);
		for (const l of this.glows) l.setVisible(on && !l.off);
	}

	setupCamera() {
		const cam = this.cameras.main;
		cam.setBounds(0, 0, W * T, H * T);
		cam.setZoom(2);
		cam.centerOn(PLAZA.x * T, (PLAZA.y - 4) * T);
		this.dragged = 0;
		this.input.on("pointerdown", () => {
			this.dragged = 0;
		});
		this.input.on("pointermove", (p) => {
			if (!p.isDown) return;
			const dx = p.x - p.prevPosition.x;
			const dy = p.y - p.prevPosition.y;
			this.dragged += Math.abs(dx) + Math.abs(dy);
			cam.scrollX -= dx / cam.zoom;
			cam.scrollY -= dy / cam.zoom;
		});
		this.input.on("wheel", (_p, _o, _dx, dy) => {
			const levels = [0.5, 1, 2, 3, 4];
			const i = levels.indexOf(cam.zoom);
			cam.setZoom(levels[Phaser.Math.Clamp((i < 0 ? 2 : i) + (dy > 0 ? -1 : 1), 0, levels.length - 1)]);
		});
	}

	clicked() {
		return this.dragged < 6;
	}

	focus(x, y) {
		this.cameras.main.pan(x, y, 600, "Sine.easeInOut");
	}

	puff(x, y) {
		const p = this.add.image(x, y, "dust").setScale(3).setAlpha(0.6).setDepth(OVERLAY - 1).setTint(0xbdb3c9);
		this.tweens.add({ targets: p, y: y - 40, x: x + 10, scale: 6, alpha: 0, duration: 2600, onComplete: () => p.destroy() });
	}

	// ---- world state ----

	apply(state) {
		if (!this.ready) {
			this.pending = state;
			return;
		}
		this.state = state;
		const { headquarters, buildings } = places(state);
		const desired = new Map();
		const districts = assign(this.memory.districts, headquarters.map((h) => h.key), SLOTS.length);
		for (const hq of headquarters) {
			const slot = SLOTS[districts[hq.key]];
			if (!slot) continue;
			desired.set(`hq:${hq.key}`, { kind: "hq", sprite: "hq", x: slot.hq.x, y: slot.hq.y, title: "Guild Hall", sub: hq.coordinator.name, coordinator: hq.coordinator, residents: [hq.coordinator] });
			this.memory.wings[hq.key] ??= {};
			const wingIdx = assign(this.memory.wings[hq.key], hq.wings.map((w) => w.tmux), 8);
			for (const w of hq.wings) {
				const i = wingIdx[w.tmux];
				if (i === undefined) continue;
				desired.set(`wing:${hq.key}:${w.tmux}`, { kind: "wing", sprite: WINGS[hash(w.tmux) % WINGS.length], x: slot.hq.x + wingOffset(i), y: slot.hq.y, title: `${w.tmux} wing`, sub: hq.coordinator.name, tmux: w.tmux, residents: w.residents, depthBias: -2 });
			}
		}
		const lots = assign(this.memory.lots, buildings.map((b) => b.tmux), COMMON_LOTS.length);
		for (const b of buildings) {
			const lot = COMMON_LOTS[lots[b.tmux]];
			if (!lot) continue;
			desired.set(`bld:${b.tmux}`, { kind: "building", sprite: HOUSES[hash(b.tmux) % HOUSES.length], x: lot.x, y: lot.y, title: b.tmux, sub: b.residents.length ? `${b.residents.length} session${b.residents.length > 1 ? "s" : ""}` : "no Pi sessions", tmux: b.tmux, residents: b.residents, dark: b.residents.length === 0 });
		}
		saveMemory(this.memory);

		for (const [key, obj] of this.placeObjs) {
			const want = desired.get(key);
			if (!want || want.sprite !== obj.spec.sprite || want.x !== obj.spec.x || want.y !== obj.spec.y) this.removePlace(key);
		}
		for (const [key, spec] of desired) {
			const obj = this.placeObjs.get(key);
			if (obj) this.updatePlace(obj, spec);
			else this.addPlace(key, spec);
		}

		const home = new Map();
		for (const [key, spec] of desired) for (const s of spec.residents) home.set(s.id, { key, x: spec.x * T, y: spec.y * T, place: spec });
		for (const [id, c] of this.chars) if (!home.has(id)) this.removeChar(id, c);
		for (const s of state.sessions) {
			const h = home.get(s.id);
			if (!h) continue;
			const c = this.chars.get(s.id);
			if (c) {
				c.session = s;
				c.home = h;
				this.setIcon(c);
			} else this.addChar(s, h);
		}
		window.dispatchEvent(new CustomEvent("town-changed", { detail: { places: [...desired.values()] } }));
	}

	addPlace(key, spec) {
		const img = this.put(spec.sprite, spec.x, spec.y, spec.depthBias ?? 0);
		img.setInteractive({ useHandCursor: true });
		img.on("pointerup", () => this.clicked() && this.inspectPlace(spec));
		const sign = this.label(spec.title, spec.x * T, spec.y * T + 40, spec.sub);
		const decor = this.placeDecor(spec, img);
		const glow = this.light(spec.x * T, spec.y * T - img.height * 0.45, img.width / 90, spec.kind === "hq" ? 0.6 : 0.45);
		const obj = { key, spec, img, sign, glow, decor };
		this.placeObjs.set(key, obj);
		this.updatePlace(obj, spec);
		img.setScale(1, 0.02);
		this.tweens.add({ targets: img, scaleY: 1, duration: 750, ease: "Back.easeOut" });
		for (let i = 0; i < 14; i++) {
			const d = this.add.image(spec.x * T + (Math.random() - 0.5) * img.width, spec.y * T - 2, "dust").setScale(2 + Math.random() * 2).setDepth(spec.y * T + 1).setAlpha(0.9);
			this.tweens.add({ targets: d, y: d.y - 10 - Math.random() * 18, x: d.x + (Math.random() - 0.5) * 30, alpha: 0, duration: 700 + Math.random() * 500, onComplete: () => d.destroy() });
		}
	}

	// A few props beside each building or wing, chosen from its key so they stay the same across reloads.
	placeDecor(spec, img) {
		if (spec.kind !== "building") return [];
		const r = rng(hash(spec.title + spec.kind));
		const kinds = ["bush", "flowerbed", "barrel", "crates", "fence", "bush"];
		const items = [];
		for (const side of [-1, 1]) {
			if (r() < 0.85) {
				const key = kinds[Math.floor(r() * kinds.length)];
				const x = spec.x * T + side * (img.width / 2 + 6 + r() * 10);
				const y = spec.y * T - 2 - r() * 10;
				const d = this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(y).setAlpha(0);
				this.tweens.add({ targets: d, alpha: 1, duration: 500, delay: 500 });
				items.push(d);
			}
		}
		return items;
	}

	updatePlace(obj, spec) {
		obj.spec = spec;
		obj.img.setTint(spec.dark ? 0x5c5a78 : 0xffffff);
		obj.sign.setText(spec.sub ? `${spec.title}\n${spec.sub}` : spec.title);
		obj.glow.off = !!spec.dark;
		obj.glow.setVisible(this.evening && !spec.dark);
	}

	removePlace(key) {
		const obj = this.placeObjs.get(key);
		this.placeObjs.delete(key);
		obj.sign.destroy();
		for (const d of obj.decor) this.tweens.add({ targets: d, alpha: 0, duration: 400, onComplete: () => d.destroy() });
		this.glows = this.glows.filter((l) => l !== obj.glow);
		obj.glow.destroy();
		this.tweens.add({ targets: obj.img, scaleY: 0, alpha: 0, duration: 500, ease: "Quad.easeIn", onComplete: () => obj.img.destroy() });
	}

	inspectPlace(spec) {
		this.focus(spec.x * T, (spec.y - 2) * T);
		window.dispatchEvent(new CustomEvent("inspect", { detail: { place: spec } }));
	}

	// ---- characters ----

	addChar(s, h) {
		const look = this.state.coordinators.includes(s.id) ? "char-coord" : LOOKS[hash(s.id) % LOOKS.length];
		const spr = this.add.sprite(h.x, h.y + 6, look, 0).setOrigin(0.5, 1).setAlpha(0);
		spr.setInteractive({ useHandCursor: true });
		const c = { session: s, home: h, look, spr, target: null, wait: Math.random() * 2, fxAt: 0, side: hash(s.id) % 2 ? 1 : -1 };
		spr.on("pointerup", () => {
			if (!this.clicked()) return;
			this.selected = s.id;
			this.focus(spr.x, spr.y - 20);
			window.dispatchEvent(new CustomEvent("inspect", { detail: { session: c.session, place: c.home.place } }));
		});
		spr.on("pointerover", () => c.name.setVisible(true));
		spr.on("pointerout", () => c.name.setVisible(this.selected === s.id));
		c.icon = this.add.image(h.x, h.y, "icon-idle").setDepth(OVERLAY + 2);
		c.name = this.add.text(h.x, h.y, s.name, { fontFamily: "-apple-system, sans-serif", fontSize: "9px", color: "#fdf3dc", backgroundColor: "rgba(43,34,56,0.85)", padding: { x: 3, y: 1 }, resolution: 4 }).setOrigin(0.5, 1).setDepth(OVERLAY + 4).setVisible(false);
		this.tweens.add({ targets: spr, alpha: 1, duration: 600 });
		this.chars.set(s.id, c);
		this.setIcon(c);
	}

	removeChar(id, c) {
		this.chars.delete(id);
		c.icon.destroy();
		c.name.destroy();
		this.tweens.add({ targets: c.spr, alpha: 0, duration: 500, onComplete: () => c.spr.destroy() });
	}

	setIcon(c) {
		c.icon.setTexture(`icon-${c.session.status}`);
		c.name.setText(c.session.name);
	}

	goal(c) {
		const { x, y } = c.home;
		if (c.session.status === "waiting") return { x, y: y + 12, still: true };
		if (c.session.status === "busy") return { x: x + c.side * (c.home.place.kind === "hq" ? 70 : 44), y: y + 18, still: true, work: true };
		return null;
	}

	update(time, delta) {
		if (!this.ready) return;
		const dt = delta / 1000;
		for (const c of this.chars.values()) {
			const g = this.goal(c);
			if (g) c.target = g;
			else if (!c.target || c.target.still) {
				c.wait -= dt;
				if (c.wait <= 0) {
					const r = Math.random();
					c.target = { x: Phaser.Math.Clamp(c.home.x + (r - 0.5) * 12 * T, 2 * T, (W - 2) * T), y: c.home.y + 8 + Math.random() * 16 };
				} else c.target = null;
			}
			const spr = c.spr;
			let moving = false;
			if (c.target) {
				const dx = c.target.x - spr.x;
				const dy = c.target.y - spr.y;
				const d = Math.hypot(dx, dy);
				if (d > 1.5) {
					const step = Math.min(d, 42 * dt);
					spr.x += (dx / d) * step;
					spr.y += (dy / d) * step;
					const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
					if (spr.anims.currentAnim?.key !== `${c.look}-${dir}` || !spr.anims.isPlaying) spr.play(`${c.look}-${dir}`);
					moving = true;
				} else if (!c.target.still) {
					c.target = null;
					c.wait = 2 + Math.random() * 4;
				}
			}
			if (!moving) {
				spr.anims.stop();
				spr.setFrame(0);
				if (g?.work && time > c.fxAt) {
					c.fxAt = time + 500 + Math.random() * 400;
					this.workFx(c);
				}
			}
			spr.setDepth(spr.y);
			const bob = c.session.status === "waiting" ? Math.round(Math.abs(Math.sin(time / 260)) * -4) : 0;
			c.icon.setPosition(Math.round(spr.x), Math.round(spr.y - spr.height - 6 + bob));
			c.name.setPosition(Math.round(spr.x), Math.round(spr.y - spr.height - 16));
		}
	}

	workFx(c) {
		const tool = c.session.tool;
		const key = tool === "edit" || tool === "write" ? "fx-edit" : tool === "bash" ? "fx-bash" : "fx-read";
		const x = c.spr.x + c.side * -6;
		const y = c.spr.y - 18;
		for (let i = 0; i < 3; i++) {
			const p = this.add.image(x, y, key).setScale(1).setDepth(OVERLAY + 2);
			this.tweens.add({ targets: p, x: x + (Math.random() - 0.5) * 14, y: y - 8 - Math.random() * 10, alpha: 0, duration: 600, delay: i * 80, onComplete: () => p.destroy() });
		}
	}
}
