// How a character shows its state in the world (ticket 07): its pose, the badge over its head, and the short speech
// bubbles (barks) of characters that need the operator. Everything here follows observed facts (decision 06); the
// seated beat following the last tool is decorative.
import type * as Phaser from "phaser";
import type { Character } from "../../src/world.js";
import { worn } from "../theme-store.js";
import type { Pose } from "./walker.js";

/** What the badge over a head says: at work, asking you something, or finished and not seen yet. */
export type BadgeKind = "working" | "asking" | "unseen";

/**
 * Indoors a working character sits at its desk (its seated frames bring the stool); outdoors there are no desks, so it
 * stands at work, busy on its feet, with the same badge.
 */
export function poseFor(character: Character, outdoors = false): Pose {
	const status = character.facts?.status;
	if (status === "asking") return "asking";
	if (status === "working") return outdoors ? "busy" : "seated";
	return "standing";
}

export function badgeFor(character: Character): BadgeKind | null {
	const facts = character.facts;
	if (facts?.status === "asking") return "asking";
	if (facts?.status === "working") return "working";
	if (facts?.unseen) return "unseen";
	return null;
}

/** Only characters that need the operator bark. */
export function needsYou(character: Character): boolean {
	const kind = badgeFor(character);
	return kind === "asking" || kind === "unseen";
}

/** Tools that keep hands busy (writing, running) beat quicker at the desk; reading is slower. Decorative only. */
export function tempoFor(character: Character): number {
	const tool = character.facts?.tool?.name ?? "";
	if (/^(edit|write|bash|pi_exec)$/.test(tool)) return 1.9;
	if (/^(read|grep|find|ls|web_?search|fetch)/.test(tool)) return 0.7;
	return 1;
}

const FINISHED_LINES = ["I'm done. Come and see!", "Finished! Take a look?", "All done here.", "Ready when you are."];
const ASKING_LINES = ["I have a question for you.", "Could you help me decide?", "I need your answer."];
const BARK_TEXT_MAX = 46;
/** The longest bark kept on one line, in px. */
const BARK_LINE = 170;

/** A short line for a character that needs the operator: its open question when the runtime has its text. */
export function barkFor(character: Character, turn: number): string | undefined {
	const facts = character.facts;
	if (!facts || !needsYou(character)) return undefined;
	if (facts.status === "asking") {
		const question = facts.asking?.text?.trim().replace(/\s+/g, " ");
		if (question && turn % 2 === 0)
			return question.length > BARK_TEXT_MAX ? `${question.slice(0, BARK_TEXT_MAX - 3).trimEnd()}...` : question;
		return ASKING_LINES[turn % ASKING_LINES.length];
	}
	return FINISHED_LINES[turn % FINISHED_LINES.length];
}

/**
 * How fast life goes by (ticket 06 and 07): idles and wandering run their timers this many times faster; 0 stops them.
 * The page may set `window.agentWorldLife = { pace }`; under a driven browser (the headless tests) life is still unless
 * a test asks for it, so the tests that read where everyone stands and which frame shows stay exact.
 */
export function lifePace(): number {
	const life = (globalThis as { agentWorldLife?: { pace?: number } }).agentWorldLife;
	if (typeof life?.pace === "number" && Number.isFinite(life.pace)) return Math.max(0, life.pace);
	return typeof navigator !== "undefined" && navigator.webdriver ? 0 : 1;
}

/** A string's 32-bit hash, the seed of someone's own rhythm. */
function hashOf(text: string): number {
	let h = 2166136261;
	for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
	return h;
}

/** A random source seeded by `seed` (mulberry32): the same character always has the same rhythm, others another. */
export function seeded(seed: string): () => number {
	let state = hashOf(seed) || 1;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A step of an idle: a frame of the look's idle sheet (`IDLE_POSES`), or -1 for the standing frame, held this long (ms). */
export type IdleStep = readonly [frame: number, ms: number];

/**
 * The idles someone standing about plays: short held poses that come back to standing. The sheet's frames are, in
 * order, looking left, looking right, a stretch, a wave, a laugh, a shrug, a nod, and a yawn.
 */
export const IDLES = {
	"look-around": [
		[0, 1100],
		[-1, 280],
		[1, 1100],
	],
	stretch: [[2, 1500]],
	wave: [
		[3, 520],
		[-1, 170],
		[3, 560],
	],
	laugh: [
		[4, 420],
		[-1, 120],
		[4, 420],
		[-1, 120],
		[4, 460],
	],
	shrug: [[5, 1100]],
	nod: [
		[6, 340],
		[-1, 220],
		[6, 360],
	],
	yawn: [[7, 1700]],
} as const satisfies Record<string, readonly IdleStep[]>;

export type IdleName = keyof typeof IDLES;
const IDLE_NAMES = Object.keys(IDLES) as IdleName[];
/** The first idle comes this long after someone stands still (ms), then one every so often: never on a beat. */
const FIRST_IDLE_MS = [1500, 11_000] as const;
const IDLE_EVERY_MS = [7000, 21_000] as const;

/**
 * When someone standing about plays an idle, and which: its own seeded rhythm, so two neighbours never start the same
 * idle together, and never the same idle twice in a row. `tick` runs with each frame's time while it stands.
 */
export class IdleClock {
	private readonly random: () => number;
	private wait: number;
	private last?: IdleName;

	constructor(seed: string) {
		this.random = seeded(`idle:${seed}`);
		this.wait = this.between(FIRST_IDLE_MS);
	}

	/**
	 * The idle to play now, if its time has come (`deltaMs` of standing has passed since the last call): never one that
	 * someone else is playing (`playing`), so two neighbours never start the same idle together.
	 */
	tick(
		deltaMs: number,
		pace = lifePace(),
		playing: Pick<ReadonlySet<IdleName>, "has"> = new Set(),
	): IdleName | undefined {
		if (pace <= 0) return undefined;
		this.wait -= Math.min(deltaMs, 100) * pace;
		if (this.wait > 0) return undefined;
		return this.pick(playing);
	}

	/** The next idle, now (a wanderer pausing at a point of interest): its clock starts the wait again. */
	pick(playing: Pick<ReadonlySet<IdleName>, "has"> = new Set()): IdleName {
		this.wait = this.between(IDLE_EVERY_MS);
		const fresh = IDLE_NAMES.filter((name) => name !== this.last && !playing.has(name));
		const choices = fresh.length ? fresh : IDLE_NAMES.filter((name) => name !== this.last);
		this.last = choices[Math.floor(this.random() * choices.length)];
		return this.last;
	}

	/** Something else kept it from playing (it walked, or sat down): the next idle waits a while again. */
	putOff() {
		this.wait = Math.max(this.wait, this.between(FIRST_IDLE_MS));
	}

	private between([least, most]: readonly [number, number]): number {
		return least + this.random() * (most - least);
	}
}

/** A `#rrggbb` colour as a number, for Phaser's fills. */
const hex = (colour: string) => Number.parseInt(colour.slice(1), 16);

export const BADGE_RADIUS = 11.5;

/** A badge, centred on (0, 0) of its container. Working shows three dots that pulse in turn. */
export function drawBadge(scene: Phaser.Scene, kind: BadgeKind): Phaser.GameObjects.Container {
	const { world } = worn();
	const style = world.badge[kind === "unseen" ? "unseen" : kind];
	const [fill, light, ink] = [hex(style.fill), hex(style.light), hex(style.ink)];
	const r = BADGE_RADIUS;
	const disc = scene.add.graphics();
	disc.fillStyle(0x000000, 0.3).fillCircle(0.8, 1.6, r + 1.6);
	disc.fillStyle(hex(world.badge.edge), 1).fillCircle(0, 0, r + 1.6);
	disc.fillStyle(hex(world.badge.rim), 1).fillCircle(0, 0, r + 0.5);
	disc.fillStyle(fill, 1).fillCircle(0, 0, r - 1);
	disc.fillStyle(light, 0.95).fillCircle(-1.6, -2.2, r - 3.2);
	disc.fillStyle(fill, 0.55).fillCircle(0.8, 1.2, r - 3.6);
	const mark = scene.add.container(0, 0, [disc]);
	const inkCss = style.ink;
	if (kind === "asking") {
		const text = scene.add
			.text(0, 0, "?", { fontFamily: world.font, fontStyle: "bold", fontSize: "16px", color: inkCss })
			.setOrigin(0.5)
			.setResolution(4);
		// Centre the glyph's ink, not its line box: Georgia's line box sits low under "?".
		text.setY(-0.5);
		mark.add(text);
	} else if (kind === "unseen") {
		const tick = scene.add.graphics();
		tick.lineStyle(2.8, ink, 1);
		tick.beginPath();
		tick.moveTo(-4.6, 0.2);
		tick.lineTo(-1.4, 3.6);
		tick.lineTo(4.8, -3.4);
		tick.strokePath();
		mark.add(tick);
	} else {
		const dots = [-4.4, 0, 4.4].map((x) => scene.add.circle(x, 0.4, 1.8, ink, 1));
		mark.add(dots);
		for (const [i, dot] of dots.entries())
			scene.tweens.add({
				targets: dot,
				alpha: 0.35,
				y: -0.8,
				duration: 420,
				delay: i * 180,
				yoyo: true,
				repeat: -1,
				repeatDelay: 300,
				ease: "Sine.inOut",
			});
	}
	// Those that need you pulse gently; the outer container is left for the scene to place and scale.
	if (kind !== "working")
		scene.tweens.add({
			targets: mark,
			scale: 1.12,
			duration: 700,
			yoyo: true,
			repeat: -1,
			ease: "Sine.inOut",
		});
	return scene.add.container(0, 0, [mark]);
}

/** A bark as drawn: its container (the tail's tip at its (0, 0)), the bubble that can slide sideways, and its size. */
export interface BarkShape {
	container: Phaser.GameObjects.Container;
	/** The bubble and its text, without the tail: slid sideways (local px) to keep clear of others and the interface. */
	body: Phaser.GameObjects.Container;
	/** The bubble's width and height, and how far it may slide either way while the tail still meets it. */
	width: number;
	height: number;
	slide: number;
	tail: number;
}

/** A speech bubble whose tail's tip is at (0, 0) of its container, the text wrapped to a few words a line. */
export function drawBark(scene: Phaser.Scene, line: string): BarkShape {
	const { font, bark } = worn().world;
	const [INK, PAPER] = [hex(bark.outline), hex(bark.paper)];
	const text = scene.add
		.text(0, 0, line, {
			fontFamily: font,
			fontSize: "13px",
			fontStyle: "bold",
			color: bark.ink,
			align: "center",
			lineSpacing: 1,
		})
		.setResolution(4)
		.setOrigin(0.5, 1);
	// One line when it is short; otherwise two lines of about equal length, not a long line and a lone word.
	const single = text.width;
	if (single > BARK_LINE) text.setWordWrapWidth(Math.max(110, single / 2 + 26));
	const padX = 9;
	const padY = 6;
	const w = Math.ceil(text.width + padX * 2);
	const h = Math.ceil(text.height + padY * 2);
	const tail = 7;
	const top = -tail - h;
	const bubble = scene.add.graphics();
	bubble.fillStyle(0x000000, 0.22).fillRoundedRect(-w / 2 + 1.5, top + 2.5, w, h, 7);
	bubble.fillStyle(INK, 1).fillRoundedRect(-w / 2 - 1.5, top - 1.5, w + 3, h + 3, 8.5);
	const tip = scene.add.graphics();
	tip.fillStyle(INK, 1).fillTriangle(-6.5, -tail - 1, 6.5, -tail - 1, 0, 1.5);
	tip.fillStyle(PAPER, 1).fillTriangle(-4.6, -tail - 1.6, 4.6, -tail - 1.6, 0, -1);
	const paper = scene.add.graphics();
	paper.fillStyle(PAPER, 1).fillRoundedRect(-w / 2, top, w, h, 7);
	text.setPosition(0, -tail - padY + 0.5);
	const body = scene.add.container(0, 0, [bubble, paper, text]);
	// The tail sits over the bubble's outline and under its paper, so the two read as one shape wherever it slides.
	const container = scene.add.container(0, 0, [body, tip]);
	container.bringToTop(tip);
	body.bringToTop(paper);
	body.bringToTop(text);
	return { container, body, width: w + 3, height: h + tail + 3, slide: Math.max(0, w / 2 - 14), tail };
}

/**
 * A sleeper's "z": small letters that rise and fade above its head one after another, slowly, so a room of sleepers
 * breathes rather than flickers. Its container's (0, 0) is where the first letter starts.
 */
export function drawZzz(scene: Phaser.Scene): Phaser.GameObjects.Container {
	const { font, sleep } = worn().world;
	const container = scene.add.container(0, 0);
	const delay = Math.random() * 1800;
	[13, 16, 19].forEach((size, i) => {
		const z = scene.add
			.text(0, 0, "z", {
				fontFamily: font,
				fontStyle: "bold italic",
				fontSize: `${size}px`,
				color: sleep.fill,
				stroke: sleep.stroke,
				strokeThickness: 2.5,
				shadow: { offsetX: 0, offsetY: 1, color: "#000000", blur: 3, fill: true, stroke: true },
			})
			.setOrigin(0.5, 1)
			.setResolution(4)
			.setAlpha(0);
		container.add(z);
		const timing = { delay: delay + i * 700, repeat: -1, repeatDelay: 1500 };
		scene.tweens.add({
			targets: z,
			x: { from: i * 2, to: 6 + i * 4 },
			y: { from: -i * 3, to: -14 - i * 4 },
			duration: 1900,
			ease: "Sine.out",
			...timing,
		});
		scene.tweens.add({
			targets: z,
			alpha: { from: 0, to: 0.95 },
			duration: 950,
			yoyo: true,
			ease: "Sine.inOut",
			...timing,
		});
	});
	return container;
}

/** A small wooden tag (the inn's stairs: how many more sleep upstairs), its bottom centre at (0, 0). */
export function drawTag(scene: Phaser.Scene, line: string): Phaser.GameObjects.Container {
	const { font, tag } = worn().world;
	const text = scene.add
		.text(0, 0, line, { fontFamily: font, fontSize: "12px", fontStyle: "bold italic", color: tag.ink })
		.setResolution(4)
		.setOrigin(0.5, 1);
	const w = Math.ceil(text.width + 18);
	const h = Math.ceil(text.height + 9);
	const plate = scene.add.graphics();
	plate.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2 + 1.5, -h + 2, w, h, 5);
	plate.fillStyle(hex(tag.rim), 1).fillRoundedRect(-w / 2 - 1.5, -h - 1.5, w + 3, h + 3, 6);
	plate.fillStyle(hex(tag.plate), 1).fillRoundedRect(-w / 2, -h, w, h, 5);
	plate
		.fillStyle(hex(tag.rivet), 1)
		.fillCircle(-w / 2 + 5, -h / 2, 1.6)
		.fillCircle(w / 2 - 5, -h / 2, 1.6);
	text.setPosition(0, -4);
	return scene.add.container(0, 0, [plate, text]);
}
