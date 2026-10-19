// PROTOTYPE: one place as a Phaser scene: a painted (or tiled) backdrop, a walk grid, characters at their spots,
// the operator's avatar, and RuneScape-style input (hover action, left-click default, right-click menu).
// Movement has two modes to compare: "smooth" (a fine grid, string-pulled paths, continuous motion) and "tiles"
// (RuneScape's tile-by-tile steps on the place's tile grid).
import { Grid } from "./grid.js";
import { closeChat, menuOpen, openMenu, say, showHover } from "./ui.js";
import { lineFor } from "./world.js";

const FINE = 2; // walk cells per tile in smooth mode
const PERSON_TILES = 1.8;
const STANDING = 120; // sprite pixels from head to feet in a standing frame (clean_characters.py HEIGHT)
const SPEED = { smooth: 175, tiles: 120 }; // world px per second
const FRAMES = { down: [0, 3], up: [4, 7], side: [8, 11], work: [12, 13] };
const STILL = { down: 0, up: 4, side: 8, sitA: 12, stand: 14, ask: 15 };

export class PlaceScene extends Phaser.Scene {
	constructor(key, build) {
		super(key);
		this.build = build; // (scene, world, data) => place description, recomputed on each entry
	}

	init(data) {
		this.entry = data?.entry ?? "start";
		this.enterData = data ?? {};
	}

	create() {
		const app = this.registry.get("app");
		this.app = app;
		const place = this.build(this, app.world, this.enterData);
		this.place = place;
		const T = place.tile;
		this.T = T;
		this.coarse = new Grid(place.cols, place.rows);
		this.fine = new Grid(place.cols * FINE, place.rows * FINE);
		for (const [x, y, w, h] of place.blocked) {
			this.coarse.block([x, y, w, h]);
			this.fine.block([x * FINE, y * FINE, w * FINE, h * FINE]);
		}
		closeChat();
		showHover([]);
		place.drawBackdrop(this);
		this.hotspots = place.hotspots ?? [];
		this.people = [];
		for (const p of place.people) this.addPerson(p);
		const start = place.entries[this.entry] ?? place.entries.start;
		this.avatar = this.makeCharacter(app.avatarLook, this.tileCenter(start), STILL.up);
		this.cameras.main.startFollow(this.avatar, true, 0.1, 0.1);
		this.applyZoom();
		this.cameras.main.fadeIn(220, 20, 14, 24);
		this.input.mouse.disableContextMenu();
		this.input.on("pointermove", (pointer) => showHover(this.actionsAt(pointer)));
		this.input.on("pointerdown", (pointer) => this.click(pointer));
		this.input.on("wheel", (_p, _o, _dx, dy) => {
			app.zoom = Phaser.Math.Clamp(app.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 3);
			this.applyZoom();
		});
		this.scale.on("resize", () => this.applyZoom());
		document.getElementById("where").textContent = place.title;
	}

	applyZoom() {
		// A place smaller than the view sits centred in the dark, as RuneScape shows a small room.
		const zoom = this.app.zoom;
		const w = this.place.cols * this.T;
		const h = this.place.rows * this.T;
		const vw = this.scale.width / zoom;
		const vh = this.scale.height / zoom;
		this.cameras.main.setZoom(zoom);
		this.cameras.main.setBounds(Math.min(0, (w - vw) / 2), Math.min(0, (h - vh) / 2), Math.max(w, vw), Math.max(h, vh));
	}

	tileCenter([x, y]) {
		return { x: (x + 0.5) * this.T, y: (y + 0.5) * this.T };
	}

	makeCharacter(look, at, frame) {
		const shadow = this.add.ellipse(at.x, at.y + this.T * 0.42, this.T * 0.62, this.T * 0.2, 0x000000, 0.28);
		const sprite = this.add.sprite(at.x, at.y + this.T * 0.45, look, frame).setOrigin(0.5, 1);
		sprite.setScale((PERSON_TILES * this.T) / STANDING);
		sprite.look = look;
		sprite.shadow = shadow;
		sprite.pos = { x: at.x, y: at.y };
		sprite.facing = "up";
		this.settle(sprite);
		return sprite;
	}

	/** Put a character's sprite and shadow at its feet position `pos`, sorted by depth. */
	settle(sprite) {
		sprite.setPosition(sprite.pos.x, sprite.pos.y + this.T * 0.45);
		sprite.shadow.setPosition(sprite.pos.x, sprite.pos.y + this.T * 0.42).setDepth(sprite.y - 1);
		sprite.setDepth(sprite.y);
	}

	addPerson({ session, at, look, pose = "stand" }) {
		const s = session;
		const frame = pose === "sit" ? (s.status === "waiting" ? STILL.ask : STILL.sitA) : s.status === "waiting" ? STILL.ask : STILL.stand;
		const sprite = this.makeCharacter(look, this.tileCenter(at), frame);
		sprite.session = s;
		sprite.tile = [...at];
		this.coarse.block([at[0], at[1], 1, 1]);
		this.fine.block([at[0] * FINE, at[1] * FINE, FINE, FINE]);
		if (pose === "sit" && s.status === "busy") sprite.play(`${look}-work`);
		const badge = this.add.container(sprite.x, sprite.y - sprite.displayHeight - 8).setDepth(100000);
		this.drawBadge(badge, s);
		this.people.push({ sprite, badge, session: s });
	}

	drawBadge(container, s) {
		const g = this.add.graphics();
		const label = (text, color) => this.add.text(0, 0, text, { fontFamily: "Georgia, serif", fontSize: "15px", fontStyle: "bold", color }).setOrigin(0.5);
		if (s.status === "waiting") {
			g.fillStyle(0xf2c14e).fillCircle(0, 0, 11).lineStyle(2, 0x2b2238).strokeCircle(0, 0, 11);
			container.add([g, label("!", "#2b2238")]);
			this.tweens.add({ targets: container, y: container.y - 5, yoyo: true, repeat: -1, duration: 520, ease: "Sine.inOut" });
		} else if (s.needsYou) {
			g.fillStyle(0x9fd88a).fillCircle(0, 0, 11).lineStyle(2, 0x2b2238).strokeCircle(0, 0, 11);
			container.add([g, label("\u2713", "#1f3a1a")]);
		} else if (s.status === "busy") {
			g.fillStyle(0x2b2238, 0.85).fillRoundedRect(-15, -8, 30, 16, 8);
			const dots = [-7, 0, 7].map((dx, i) => {
				const d = this.add.circle(dx, 0, 2.6, 0xf3e9d2);
				this.tweens.add({ targets: d, alpha: 0.25, yoyo: true, repeat: -1, duration: 420, delay: i * 140 });
				return d;
			});
			container.add([g, ...dots]);
		}
	}

	pointerWorld(pointer) {
		return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
	}

	/** Every action under the pointer, the default first, as RuneScape lists them. */
	actionsAt(pointer) {
		if (menuOpen()) return [];
		const world = this.pointerWorld(pointer);
		const tile = [Math.floor(world.x / this.T), Math.floor(world.y / this.T)];
		const actions = [];
		const person = this.people.find((p) => p.sprite.getBounds().contains(world.x, world.y));
		if (person) {
			const s = person.session;
			actions.push({ verb: "Talk-to", target: s.name, kind: "npc", run: () => this.approach(person.sprite.tile, () => this.talk(s), true) });
			actions.push({ verb: "Examine", target: s.name, kind: "npc", run: () => this.examine(s) });
		}
		for (const h of this.hotspots) {
			const [x, y, w, hh] = h.rect;
			if (tile[0] >= x && tile[0] < x + w && tile[1] >= y && tile[1] < y + hh)
				for (const v of h.verbs) actions.push({ verb: v.verb, target: h.name, run: () => this.approach(h.standAt, () => v.run(this), false, true) });
		}
		actions.push({ verb: "Walk here", run: () => this.walkTo(world) });
		return actions;
	}

	click(pointer) {
		if (menuOpen()) return;
		const actions = this.actionsAt(pointer);
		if (pointer.rightButtonDown()) openMenu(pointer.event.clientX, pointer.event.clientY, actions);
		else actions[0].run();
	}

	marker(world, red) {
		const g = this.add.graphics().setDepth(99999);
		g.lineStyle(3, red ? 0xd8452b : 0xf2d24e, 1);
		g.lineBetween(-7, -7, 7, 7).lineBetween(-7, 7, 7, -7);
		g.setPosition(world.x, world.y);
		this.tweens.add({ targets: g, scale: 0.3, alpha: 0, duration: 420, onComplete: () => g.destroy() });
	}

	/** Walk to a point; on a blocked spot, as close to it as the floor allows (RuneScape does the same). */
	walkTo(world, then) {
		closeChat();
		this.marker(world, false);
		this.route(world, then);
	}

	/** Walk next to a target, then act: the RuneScape rhythm. */
	approach(target, act, person, exact) {
		closeChat();
		this.marker(this.tileCenter(target), true);
		const stand = exact ? target : this.coarse.besideNearest(target, this.avatarTile());
		if (!stand) return;
		this.route(this.tileCenter(stand), () => {
			if (person) this.faceToward(this.avatar, this.tileCenter(target));
			act();
		});
	}

	avatarTile() {
		return [Math.floor(this.avatar.pos.x / this.T), Math.floor(this.avatar.pos.y / this.T)];
	}

	route(goal, then) {
		const mode = this.app.movement;
		const unit = mode === "smooth" ? this.T / FINE : this.T;
		const grid = mode === "smooth" ? this.fine : this.coarse;
		const cell = (p) => [Math.floor(p.x / unit), Math.floor(p.y / unit)];
		const center = ([x, y]) => ({ x: (x + 0.5) * unit, y: (y + 0.5) * unit });
		const from = cell(this.avatar.pos);
		let to = cell(goal);
		let exactGoal = grid.free(...to);
		if (!exactGoal) {
			to = nearestFree(grid, to);
			if (!to) return;
		}
		const path = grid.path(from, to);
		if (!path) return;
		let points;
		if (mode === "smooth") {
			points = stringPull(grid, path).slice(1).map(center);
			// Finish exactly on the clicked point when it is open floor, not on the cell's centre.
			if (exactGoal && points.length) points[points.length - 1] = { x: goal.x, y: goal.y };
			else if (exactGoal) points = [{ x: goal.x, y: goal.y }];
		} else points = path.slice(1).map(center);
		this.walk = { points, then };
	}

	update(_time, delta) {
		const walk = this.walk;
		if (!walk) return;
		const a = this.avatar;
		let budget = (SPEED[this.app.movement] * delta) / 1000;
		while (budget > 0 && walk.points.length) {
			const target = walk.points[0];
			const dx = target.x - a.pos.x;
			const dy = target.y - a.pos.y;
			const dist = Math.hypot(dx, dy);
			if (dist > 0.01) this.faceToward(a, target, true);
			if (dist <= budget) {
				a.pos = { x: target.x, y: target.y };
				walk.points.shift();
				budget -= dist;
			} else {
				a.pos = { x: a.pos.x + (dx / dist) * budget, y: a.pos.y + (dy / dist) * budget };
				budget = 0;
			}
		}
		this.settle(a);
		if (!walk.points.length) {
			this.walk = null;
			a.anims.stop();
			a.setFrame(STILL[a.facing === "left" || a.facing === "right" ? "side" : a.facing]);
			walk.then?.();
		}
	}

	faceToward(sprite, target, walking) {
		const dx = target.x - sprite.pos.x;
		const dy = target.y - sprite.pos.y;
		const dir = Math.abs(dx) > Math.abs(dy) * 0.9 ? (dx > 0 ? "right" : "left") : dy < 0 ? "up" : "down";
		sprite.setFlipX(dir === "right");
		const row = dir === "left" || dir === "right" ? "side" : dir;
		if (walking) {
			const key = `${sprite.look}-${row}`;
			if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) sprite.play(key);
		} else sprite.setFrame(STILL[row]);
		sprite.facing = dir;
	}

	talk(s) {
		say(s.name, lineFor(s), s.status === "waiting" ? ["Show me the question.", "Later."] : ["Tell me more.", "Goodbye."], this.portraitFor(s));
	}

	examine(s) {
		const bits = [s.coordinator ? "Coordinator of this guild." : s.repository ? `Works on ${s.repository}.` : "Works without a repository."];
		if (s.task) bits.push(`Task: ${s.task}.`);
		bits.push(s.awake ? `Status: ${s.status}${s.needsYou ? ", finished and unseen" : ""}.` : "Dormant.");
		say(s.name, bits.join(" "), ["Goodbye."], this.portraitFor(s));
	}

	portraitFor(s) {
		const person = this.people.find((p) => p.session === s);
		const look = person?.sprite.look;
		if (!look || !this.app.chars[look]?.portraits) return null;
		const mood = s.status === "waiting" ? 3 : s.needsYou ? 1 : s.status === "busy" ? 2 : 0;
		return `assets/chars/${look}-portrait-${mood}.png`;
	}

	go(key, entry, extra = {}) {
		this.cameras.main.fadeOut(220, 20, 14, 24);
		this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start(key, { entry, ...extra }));
	}

	note(text) {
		say("", text);
	}
}

/** The free cell nearest to `cell`, searched ring by ring. */
function nearestFree(grid, [cx, cy]) {
	for (let r = 1; r < Math.max(grid.w, grid.h); r++)
		for (let dy = -r; dy <= r; dy++)
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				if (grid.free(cx + dx, cy + dy)) return [cx + dx, cy + dy];
			}
	return null;
}

/** Drop every waypoint that a straight walk can skip, keeping clear of walls by a little more than a body's width. */
function stringPull(grid, path) {
	const clear = (a, b) => {
		const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 4);
		for (let i = 0; i <= steps; i++) {
			const x = a[0] + 0.5 + ((b[0] - a[0]) * i) / steps;
			const y = a[1] + 0.5 + ((b[1] - a[1]) * i) / steps;
			for (const [ox, oy] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) if (!grid.free(Math.floor(x + ox), Math.floor(y + oy))) return false;
		}
		return true;
	};
	const out = [path[0]];
	let i = 0;
	while (i < path.length - 1) {
		let j = path.length - 1;
		while (j > i + 1 && !clear(path[i], path[j])) j--;
		out.push(path[j]);
		i = j;
	}
	return out;
}

export function makeCharacterAnims(scene, looks) {
	for (const look of looks)
		for (const [row, [start, end]] of Object.entries(FRAMES)) {
			const key = `${look}-${row}`;
			if (!scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(look, { start, end }), frameRate: row === "work" ? 2 : 9, repeat: -1 });
		}
}
