// PROTOTYPE: one place as a Phaser scene: a painted (or tiled) backdrop, a walk grid, characters at their spots,
// the operator's avatar, and RuneScape-style input (hover action, left-click default, right-click menu).
import { Grid } from "./grid.js";
import { closeChat, menuOpen, openMenu, say, showHover } from "./ui.js";
import { lineFor } from "./world.js";

const DIRS = ["down", "left", "right", "up"];
const STEP_MS = 300;
const PERSON_TILES = 1.75;

export class PlaceScene extends Phaser.Scene {
	constructor(key, build) {
		super(key);
		this.build = build; // (scene, world) => place description, recomputed on each entry
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
		this.grid = new Grid(place.cols, place.rows);
		for (const r of place.blocked) this.grid.block(r);
		place.drawBackdrop(this);
		this.hotspots = place.hotspots ?? [];
		this.people = [];
		for (const p of place.people) this.addPerson(p);
		const start = place.entries[this.entry] ?? place.entries.start;
		this.avatar = this.makeWalker(app.avatarLook, start, "down");
		this.avatar.tile = [...start];
		this.cameras.main.startFollow(this.avatar, true, 0.12, 0.12);
		this.applyZoom();
		this.cameras.main.fadeIn(220, 20, 14, 24);
		this.input.mouse.disableContextMenu();
		this.input.on("pointermove", (pointer) => showHover(this.actionsAt(pointer)));
		this.input.on("pointerdown", (pointer) => this.click(pointer));
		this.input.on("wheel", (_p, _o, _dx, dy) => {
			app.zoom = Phaser.Math.Clamp(app.zoom * (dy > 0 ? 0.9 : 1.1), 0.6, 3);
			this.applyZoom();
		});
		this.scale.on("resize", () => this.applyZoom());
		document.getElementById("where").textContent = place.title;
		app.onPlace?.(this);
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

	center([x, y]) {
		return [(x + 0.5) * this.T, (y + 0.5) * this.T];
	}

	makeWalker(look, tile, face) {
		const [x, y] = this.center(tile);
		const sprite = this.add.sprite(x, y + this.T * 0.45, look, DIRS.indexOf(face) * 4);
		sprite.setOrigin(0.5, 1);
		sprite.setScale((PERSON_TILES * this.T) / 40);
		sprite.setDepth(sprite.y);
		sprite.look = look;
		return sprite;
	}

	addPerson({ session, at, face = "down", look }) {
		const sprite = this.makeWalker(look, at, face);
		sprite.session = session;
		sprite.tile = [...at];
		this.grid.block([at[0], at[1], 1, 1]);
		const badge = this.add.container(sprite.x, sprite.y - sprite.displayHeight - 6).setDepth(100000);
		this.drawBadge(badge, session);
		this.people.push({ sprite, badge, session });
		if (session.status === "busy") this.tweens.add({ targets: sprite, scaleY: sprite.scaleY * 1.03, yoyo: true, repeat: -1, duration: 650, ease: "Sine.inOut" });
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

	pointerTile(pointer) {
		const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
		return { world: p, tile: [Math.floor(p.x / this.T), Math.floor(p.y / this.T)] };
	}

	/** Every action under the pointer, the default first, as RuneScape lists them. */
	actionsAt(pointer) {
		if (menuOpen()) return [];
		const { world, tile } = this.pointerTile(pointer);
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
		if (this.grid.free(...tile)) actions.push({ verb: "Walk here", run: () => this.walkTo(tile, world) });
		return actions;
	}

	click(pointer) {
		if (menuOpen()) return;
		const actions = this.actionsAt(pointer);
		if (!actions.length) return;
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

	walkTo(tile, world, then) {
		closeChat();
		if (world) this.marker(world, false);
		const path = this.grid.path(this.avatar.tile, tile);
		if (!path) return;
		this.follow(path.slice(1), then);
	}

	/** Walk next to a target, then act: the RuneScape rhythm. */
	approach(target, act, person, exact) {
		closeChat();
		const [cx, cy] = this.center(target);
		this.marker({ x: cx, y: cy }, true);
		const stand = exact ? target : this.grid.besideNearest(target, this.avatar.tile);
		if (!stand) return;
		const path = this.grid.path(this.avatar.tile, stand);
		if (!path) return;
		this.follow(path.slice(1), () => {
			if (person) this.face(this.avatar, target);
			act();
		});
	}

	follow(steps, then) {
		this.walkToken = (this.walkToken ?? 0) + 1;
		const token = this.walkToken;
		const next = () => {
			if (token !== this.walkToken) return;
			const step = steps.shift();
			if (!step) {
				this.avatar.anims.stop();
				this.avatar.setFrame(DIRS.indexOf(this.avatar.facing ?? "down") * 4);
				then?.();
				return;
			}
			const diagonal = step[0] !== this.avatar.tile[0] && step[1] !== this.avatar.tile[1];
			this.face(this.avatar, step, true);
			this.avatar.tile = step;
			const [x, y] = this.center(step);
			this.tweens.add({
				targets: this.avatar,
				x,
				y: y + this.T * 0.45,
				duration: STEP_MS * (diagonal ? 1.4 : 1),
				onUpdate: () => this.avatar.setDepth(this.avatar.y),
				onComplete: next,
			});
		};
		next();
	}

	face(sprite, [tx, ty], walking) {
		const [x, y] = sprite.tile;
		const dx = tx - x;
		const dy = ty - y;
		const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy < 0 ? "up" : "down";
		sprite.facing = dir;
		if (walking) {
			const key = `${sprite.look}-${dir}`;
			if (sprite.anims.currentAnim?.key !== key) sprite.play(key);
		} else sprite.setFrame(DIRS.indexOf(dir) * 4);
	}

	talk(s) {
		say(s.name, lineFor(s), s.status === "waiting" ? ["Show me the question.", "Later."] : ["Tell me more.", "Goodbye."]);
	}

	examine(s) {
		const bits = [s.coordinator ? "Coordinator of this guild." : s.repository ? `Works on ${s.repository}.` : "Works without a repository."];
		if (s.task) bits.push(`Task: ${s.task}.`);
		bits.push(s.awake ? `Status: ${s.status}${s.needsYou ? ", finished and unseen" : ""}.` : "Dormant.");
		say(s.name, bits.join(" "));
	}

	go(key, entry, extra = {}) {
		this.cameras.main.fadeOut(220, 20, 14, 24);
		this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start(key, { entry, ...extra }));
	}

	note(text) {
		say("", text);
	}
}

export function makeWalkAnims(scene, looks) {
	for (const look of looks)
		DIRS.forEach((dir, row) => {
			const key = `${look}-${dir}`;
			if (!scene.anims.exists(key)) scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(look, { start: row * 4, end: row * 4 + 3 }), frameRate: 8, repeat: -1 });
		});
}
