// How a character shows its state in the world (ticket 07): its pose, the badge over its head, and the short speech
// bubbles (barks) of characters that need the operator. Everything here follows observed facts (decision 06); the
// seated beat following the last tool is decorative.
import type * as Phaser from "phaser";
import type { Character } from "../../src/world.js";
import type { Pose } from "./walker.js";

/** What the badge over a head says: at work, asking you something, or finished and not seen yet. */
export type BadgeKind = "working" | "asking" | "unseen";

export function poseFor(character: Character): Pose {
	const status = character.facts?.status;
	return status === "asking" ? "asking" : status === "working" ? "seated" : "standing";
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

const INK = 0x3a2412;
const PAPER = 0xfbf0d2;
const SERIF = 'Georgia, "Iowan Old Style", serif';

/**
 * The badge as drawn: a small enamelled disc with a brass rim and a centred mark, in the colours of the interface's
 * state pips, so the world and the side panel speak one language: a question, a tick, or three working dots.
 */
const BADGE_STYLE: Record<BadgeKind, { fill: number; light: number; ink: number }> = {
	asking: { fill: 0xe0a422, light: 0xffe08a, ink: 0x3a2405 },
	unseen: { fill: 0x6fb658, light: 0xc8f0b0, ink: 0x183312 },
	working: { fill: 0x2e2238, light: 0x5a456c, ink: 0xf3e9d2 },
};
export const BADGE_RADIUS = 11.5;

/** A badge, centred on (0, 0) of its container. Working shows three dots that pulse in turn. */
export function drawBadge(scene: Phaser.Scene, kind: BadgeKind): Phaser.GameObjects.Container {
	const { fill, light, ink } = BADGE_STYLE[kind];
	const r = BADGE_RADIUS;
	const disc = scene.add.graphics();
	disc.fillStyle(0x000000, 0.3).fillCircle(0.8, 1.6, r + 1.6);
	disc.fillStyle(0x4a3214, 1).fillCircle(0, 0, r + 1.6);
	disc.fillStyle(0xe9c773, 1).fillCircle(0, 0, r + 0.5);
	disc.fillStyle(fill, 1).fillCircle(0, 0, r - 1);
	disc.fillStyle(light, 0.95).fillCircle(-1.6, -2.2, r - 3.2);
	disc.fillStyle(fill, 0.55).fillCircle(0.8, 1.2, r - 3.6);
	const mark = scene.add.container(0, 0, [disc]);
	const inkCss = `#${ink.toString(16).padStart(6, "0")}`;
	if (kind === "asking") {
		const text = scene.add
			.text(0, 0, "?", { fontFamily: SERIF, fontStyle: "bold", fontSize: "16px", color: inkCss })
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

/** A speech bubble whose tail's tip is at (0, 0) of its container, the text wrapped to a few words a line. */
export function drawBark(scene: Phaser.Scene, line: string): Phaser.GameObjects.Container {
	const text = scene.add
		.text(0, 0, line, {
			fontFamily: SERIF,
			fontSize: "13px",
			fontStyle: "bold",
			color: "#3a2412",
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
	const bubble = scene.add.graphics();
	const top = -tail - h;
	bubble.fillStyle(0x000000, 0.22).fillRoundedRect(-w / 2 + 1.5, top + 2.5, w, h, 7);
	bubble.fillStyle(INK, 1).fillRoundedRect(-w / 2 - 1.5, top - 1.5, w + 3, h + 3, 8.5);
	bubble.fillTriangle(-6.5, -tail - 1, 6.5, -tail - 1, 0, 1.5);
	bubble.fillStyle(PAPER, 1).fillRoundedRect(-w / 2, top, w, h, 7);
	bubble.fillTriangle(-4.6, -tail - 1.6, 4.6, -tail - 1.6, 0, -1);
	text.setPosition(0, -tail - padY + 0.5);
	return scene.add.container(0, 0, [bubble, text]);
}
