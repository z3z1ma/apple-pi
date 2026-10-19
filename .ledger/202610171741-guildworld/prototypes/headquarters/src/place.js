// PROTOTYPE: one place as a Phaser scene: a painted (or tiled) backdrop, a walk grid, characters at their spots,
// the operator's avatar, and RuneScape-style input (hover action, left-click default, right-click menu).
// Movement has two modes to compare: "smooth" (a fine grid, string-pulled paths, continuous motion) and "tiles"
// (RuneScape's tile-by-tile steps on the place's tile grid).
import { Grid } from "./grid.js";
import { closeTalk, openTalk, talkOpen } from "./talk.js";
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
		for (const r of place.blocked) {
			this.coarse.block(cells(r, 1));
			this.fine.block(cells(r, FINE));
		}
		closeChat();
		closeTalk();
		showHover([]);
		place.drawBackdrop(this);
		this.hotspots = place.hotspots ?? [];
		this.people = [];
		for (const p of place.people) this.addPerson(p);
		this.props = (place.props ?? []).map((p) => this.addProp(p));
		this.time.addEvent({ delay: 2600, loop: true, callback: () => this.bark() });
		const start = place.entries[this.entry] ?? place.entries.start;
		this.avatar = this.makeCharacter(app.avatarLook, this.pt(start), STILL.up);
		if (app.showGrid) this.drawGrid();
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

	/** A place coordinate in tiles (fractions allowed) as a world point. */
	pt([x, y]) {
		return { x: x * this.T, y: y * this.T };
	}

	/** The fine walk grid over the painting, blocked cells in red: a prototype aid for tracing furniture. */
	drawGrid() {
		const g = this.add.graphics().setDepth(99990);
		const u = this.T / FINE;
		for (let y = 0; y < this.fine.h; y++)
			for (let x = 0; x < this.fine.w; x++) {
				g.fillStyle(this.fine.free(x, y) ? 0x40ff80 : 0xff3030, this.fine.free(x, y) ? 0.08 : 0.28).fillRect(x * u + 1, y * u + 1, u - 2, u - 2);
			}
	}

	makeCharacter(look, at, frame) {
		const shadow = this.add.ellipse(at.x, at.y, this.T * 0.62, this.T * 0.2, 0x000000, 0.28);
		const sprite = this.add.sprite(at.x, at.y, look, frame).setOrigin(0.5, 1);
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
		sprite.setPosition(sprite.pos.x, sprite.pos.y - (sprite.lift ?? 0));
		sprite.shadow.setPosition(sprite.pos.x, sprite.pos.y - 2).setDepth(sprite.pos.y - 1);
		sprite.setDepth(sprite.pos.y);
	}

	addPerson({ session, at, look, pose = "stand" }) {
		const s = session;
		// Asking you, an agent stands up beside its stool rather than on it.
		if (pose === "sit" && s.status === "waiting") at = [at[0] + 0.7, at[1] + 0.15];
		const frame = pose === "sit" ? (s.status === "waiting" ? STILL.ask : STILL.sitA) : s.status === "waiting" ? STILL.ask : STILL.stand;
		const sprite = this.makeCharacter(look, this.pt(at), frame);
		sprite.session = s;
		if (pose === "sit" && s.status !== "waiting") {
			// Seated frames draw no seat: lift the body onto the stool painted at the spot, whose shadow is painted too.
			sprite.lift = -this.T * 0.32;
			sprite.shadow.setVisible(false);
			this.settle(sprite);
		}
		this.coarse.block([Math.floor(at[0]), Math.floor(at[1]), 1, 1]);
		this.fine.block(cells([at[0] - 0.3, at[1] - 0.3, 0.6, 0.5], FINE));
		if (pose === "sit" && s.status === "busy") sprite.play(`${look}-work`);
		const person = { sprite, badge: null, session: s };
		this.people.push(person);
		this.redrawBadge(person);
	}

	redrawBadge(person) {
		person.badge?.destroy();
		const { sprite, session } = person;
		person.badge = this.add.container(sprite.x, sprite.y - sprite.displayHeight - 8).setDepth(100000);
		this.drawBadge(person.badge, session);
	}

	/** Now and then a character that needs you says so in a speech bubble: state that reads from a distance. */
	bark() {
		const candidates = this.people.filter((p) => !p.bubble && (p.session.status === "waiting" || p.session.needsYou || p.session.unread));
		if (!candidates.length || Math.random() < 0.4) return;
		const person = candidates[Math.floor(Math.random() * candidates.length)];
		const s = person.session;
		const line = s.status === "waiting" ? "I have a question!" : s.needsYou ? "Done! Come and see." : `${s.unread} new in ${s.name}`;
		const text = this.add.text(0, 0, line, { fontFamily: "Georgia, serif", fontSize: "14px", color: "#2b1d12" }).setOrigin(0.5);
		const w = text.width + 18;
		const g = this.add.graphics();
		g.fillStyle(0xfff6e0, 0.97).fillRoundedRect(-w / 2, -14, w, 28, 10).lineStyle(2, 0x6b4a2a).strokeRoundedRect(-w / 2, -14, w, 28, 10);
		g.fillStyle(0xfff6e0, 0.97).fillTriangle(-6, 13, 6, 13, 0, 21);
		const { sprite } = person;
		const bubble = this.add.container(sprite.x, sprite.y - sprite.displayHeight - 44, [g, text]).setDepth(100001).setAlpha(0);
		person.bubble = bubble;
		this.tweens.add({ targets: bubble, alpha: 1, y: bubble.y - 6, duration: 220 });
		this.time.delayedCall(2600, () =>
			this.tweens.add({ targets: bubble, alpha: 0, duration: 300, onComplete: () => { bubble.destroy(); person.bubble = null; } }),
		);
	}

	/** An overlaid thing to interact with, drawn over the painting at its feet position. */
	addProp({ key, at, frame = 0, name, verbs }) {
		const { x, y } = this.pt(at);
		const sprite = this.add.sprite(x, y, key, frame).setOrigin(0.5, 1).setDepth(y);
		sprite.prop = { name, verbs };
		sprite.pos = { x, y };
		this.fine.block(cells([at[0] - 0.3, at[1] - 0.25, 0.6, 0.4], FINE));
		return sprite;
	}

	purr(sprite) {
		sprite.setFrame(3);
		const heart = this.add.text(sprite.x, sprite.y - sprite.displayHeight, "\u2665", { fontSize: "20px", color: "#ff7aa8" }).setOrigin(0.5).setDepth(100000);
		this.tweens.add({ targets: heart, y: heart.y - 30, alpha: 0, duration: 1100, onComplete: () => heart.destroy() });
		this.time.delayedCall(1300, () => sprite.setFrame(Math.random() < 0.5 ? 1 : 2));
	}

	drawBadge(container, s) {
		const g = this.add.graphics();
		const label = (text, color) => this.add.text(0, 0, text, { fontFamily: "Georgia, serif", fontSize: "15px", fontStyle: "bold", color }).setOrigin(0.5);
		if (s.channel) {
			if (!s.unread) return;
			g.fillStyle(0x4a90d9).fillCircle(0, 0, 11).lineStyle(2, 0x1b2a40).strokeCircle(0, 0, 11);
			container.add([g, label(String(s.unread), "#ffffff")]);
		} else if (s.status === "waiting") {
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
		if (menuOpen() || talkOpen()) return [];
		const world = this.pointerWorld(pointer);
		const tx = world.x / this.T;
		const ty = world.y / this.T;
		const actions = [];
		const person = this.people.find((p) => p.sprite.getBounds().contains(world.x, world.y));
		if (person) {
			const s = person.session;
			actions.push({ verb: "Talk-to", target: s.name, kind: "npc", run: () => this.approach(person.sprite.pos, () => this.talk(s), true) });
			actions.push({ verb: "Examine", target: s.name, kind: "npc", run: () => this.examine(s) });
		}
		const prop = this.props.find((p) => p.getBounds().contains(world.x, world.y));
		if (prop) for (const v of prop.prop.verbs) actions.push({ verb: v.verb, target: prop.prop.name, run: () => this.approach(prop.pos, () => v.run(this, prop), true) });
		for (const h of this.hotspots) {
			const [x, y, w, hh] = h.rect;
			if (tx >= x && tx < x + w && ty >= y && ty < y + hh)
				for (const v of h.verbs) actions.push({ verb: v.verb, target: h.name, run: () => this.approach(this.pt(h.standAt), () => v.run(this), false, true) });
		}
		actions.push({ verb: "Walk here", run: () => this.walkTo(world) });
		return actions;
	}

	click(pointer) {
		if (menuOpen() || talkOpen()) return;
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
	walkTo(world) {
		closeChat();
		this.marker(world, false);
		this.route(world);
	}

	/** Walk next to a target (a world point), then act: the RuneScape rhythm. */
	approach(target, act, person, exact) {
		closeChat();
		this.marker(target, true);
		const stand = exact ? target : this.beside(target);
		if (!stand) return;
		this.route(stand, () => {
			if (person) this.faceToward(this.avatar, target);
			act();
		});
	}

	/** An open spot about a step from `target`, on the side nearest the avatar. */
	beside(target) {
		const u = this.T / FINE;
		let best = null;
		for (let y = 0; y < this.fine.h; y++)
			for (let x = 0; x < this.fine.w; x++) {
				if (!this.fine.free(x, y)) continue;
				const c = { x: (x + 0.5) * u, y: (y + 0.5) * u };
				const d = Math.hypot(c.x - target.x, c.y - target.y) / this.T;
				if (d < 0.55 || d > 1.3) continue;
				const score = d + Math.hypot(c.x - this.avatar.pos.x, c.y - this.avatar.pos.y) / this.T / 10;
				if (!best || score < best.score) best = { c, score };
			}
		return best?.c ?? null;
	}

	route(goal, then) {
		const mode = this.app.movement;
		const unit = mode === "smooth" ? this.T / FINE : this.T;
		const grid = mode === "smooth" ? this.fine : this.coarse;
		const cell = (p) => [Math.floor(p.x / unit), Math.floor(p.y / unit)];
		const center = ([x, y]) => ({ x: (x + 0.5) * unit, y: (y + 0.5) * unit });
		const from = cell(this.avatar.pos);
		const open = grid.free(...cell(goal));
		const to = open ? cell(goal) : nearestFree(grid, cell(goal));
		const path = to && grid.path(from, to);
		if (!path) return;
		let points;
		if (mode === "smooth") {
			points = stringPull(grid, path).slice(1).map(center);
			// Finish exactly on the clicked point when it is open floor, not on the cell's centre.
			if (open) points = [...points.slice(0, -1), { x: goal.x, y: goal.y }];
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
		if (s.channel) {
			say(s.name, lineFor(s), ["Reply as myself (not in this prototype).", "Ask an agent to look into it (not in this prototype).", "Goodbye."], this.portraitFor(s));
			return;
		}
		openTalk(s, this.portraitFor(s), {
			changed: (changed) => {
				const person = this.people.find((p) => p.session === changed);
				if (!person) return;
				this.redrawBadge(person);
				if (person.sprite.lift !== undefined && changed.status === "busy") person.sprite.play(`${person.sprite.look}-work`);
				else if (person.sprite.lift !== undefined) person.sprite.anims.stop();
			},
			terminal: () => {
				closeTalk();
				this.note(`Would switch tmux to ${s.name}'s pane (prototype: not wired).`);
			},
		});
	}

	examine(s) {
		if (s.channel) {
			say(s.name, `A Slack channel${s.unread ? `, ${s.unread} unread` : ""}. Seed data: this prototype has no Slack connection.`, ["Goodbye."], this.portraitFor(s));
			return;
		}
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

/** The cells of a grid with `per` cells per tile that an area [x, y, w, h] in tiles covers (by cell centre). */
function cells([x, y, w, h], per) {
	const x0 = Math.round(x * per);
	const y0 = Math.round(y * per);
	return [x0, y0, Math.round((x + w) * per) - x0, Math.round((y + h) * per) - y0];
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
