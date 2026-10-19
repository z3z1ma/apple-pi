// The town square's townsfolk (ticket 27): each Slack channel with unread messages stands in the square as a
// townsperson, in one of the theme's `townsfolk` looks chosen by the channel's id, with a small unread badge over its
// head and the channel's name on a sign while the pointer is over it. Talking to one reads its channel; the crier (the
// square's host) reaches every other channel. Agents come first: townsfolk stand only on painted spots no agent
// holds, so the square never holds more people than its painting was laid out for (the bound, see this file's
// context file). The street beyond the square (ticket 09 of the alive pass) holds the channels the square has no room
// for, on its own painted spots, the same way.
import * as Phaser from "phaser";
import type { SlackChannel } from "../../../src/integrations.js";
import { channelTitle, slack, unreadLabel } from "../../overlay/places/slack-state.js";
import { squarePanels } from "../../overlay/places/square-panels.js";
import { type Door, type PlaceData, type Point, type Rect, type Theme, TILE } from "../../theme.js";
import { worn } from "../../theme-store.js";
import { type Action, action, type Target } from "../actions.js";
import { drawTag } from "../character-life.js";
import { findPath, gridFor } from "../pathing.js";
import { PERSON_TILES, Walker } from "../walker.js";
import type { Wander } from "../wander.js";

/** Where the unread badge floats, in tiles above the feet (as an agent's state badge does). */
const BADGE_LIFT = 1.93;
/** The channel's sign while the pointer is over its townsperson, in tiles above the feet (over the badge). */
const SIGN_LIFT = 2.55;
/** A townsperson fades in on its spot, and out of it, over this long (ms): they gather quietly, not through doors. */
const FADE_MS = 650;
/** Now and then a townsperson looks about (to a neighbour, then back to the room): every this many ms, at random. */
const LOOK_ABOUT_MS = [7000, 16_000] as const;
const LOOK_AWAY_MS = [1800, 3600] as const;
const STANDING = 120;

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}

/** The look each channel wore when it last stood in the square, for as long as the app runs (per theme). */
const keptLooks = new Map<string, string>();

const townsfolkChoices = (theme: Theme) =>
	Object.entries(theme.looks)
		.filter(([, look]) => look.role === "townsfolk")
		.map(([name]) => name)
		.sort();

/**
 * The townsfolk look a channel wears: the one it wore when it last stood in the square, else the one its id hashes to,
 * so the crier's list and the channel's panel show the person standing in the square.
 */
export function townsfolkLook(theme: Theme, channelId: string): string | undefined {
	const choices = townsfolkChoices(theme);
	const kept = keptLooks.get(channelId);
	if (kept && choices.includes(kept)) return kept;
	return choices.length ? choices[hash(channelId) % choices.length] : undefined;
}

/**
 * Looks for the channels standing together (`ids`, in the square's order): those already standing keep theirs
 * (`standing`); each newcomer takes the look it wore before or its id's look while no one else wears it, else the next
 * look worn by the fewest, so no two townspeople look alike until there are more of them than looks.
 */
export function chooseTownsfolkLooks(
	choices: string[],
	ids: string[],
	standing: Map<string, string>,
	kept: Map<string, string> = new Map(),
): Map<string, string> {
	const looks = new Map<string, string>();
	if (!choices.length) return looks;
	const uses = new Map(choices.map((look) => [look, 0]));
	const take = (id: string, look: string) => {
		looks.set(id, look);
		uses.set(look, (uses.get(look) ?? 0) + 1);
	};
	for (const id of ids) {
		const look = standing.get(id);
		if (look && uses.has(look)) take(id, look);
	}
	for (const id of ids) {
		if (looks.has(id)) continue;
		const fewest = Math.min(...uses.values());
		const before = kept.get(id);
		if (before && uses.get(before) === fewest) {
			take(id, before);
			continue;
		}
		const from = hash(id) % choices.length;
		for (let i = 0; i < choices.length; i++) {
			const look = choices[(from + i) % choices.length];
			if (uses.get(look) === fewest) {
				take(id, look);
				break;
			}
		}
	}
	return looks;
}

/**
 * Which channels stand in the square, on which of the free spots (painted spots no agent holds): the first as many
 * channels as there are free spots, in the backend's order (mentions first, then the newest). A channel keeps the spot
 * it held while it stays among them, so nobody shuffles when another comes or goes; newcomers take free spots in the
 * painting's order.
 */
export function townsfolkSpots(
	channels: Pick<SlackChannel, "id">[],
	free: number[],
	held: Map<string, number>,
): Map<string, number> {
	const standing = channels.slice(0, free.length);
	const open = new Set(free);
	const spots = new Map<string, number>();
	for (const { id } of standing) {
		const spot = held.get(id);
		if (spot !== undefined && open.has(spot)) {
			spots.set(id, spot);
			open.delete(spot);
		}
	}
	const rest = free.filter((spot) => open.has(spot));
	for (const { id } of standing) if (!spots.has(id)) spots.set(id, rest.shift()!);
	return spots;
}

export interface TownsfolkView {
	id: string;
	name: string;
	look: string;
	x: number;
	y: number;
	moving: boolean;
	/** What its badge says: the unread count (`12`, `100+`), or a dot when uncounted. */
	badge: string;
	mentions: number;
	/** The channel's sign shows (the pointer is over it). */
	sign: boolean;
	alpha: number;
	/** The idle it is playing (ticket 06). */
	idle: string | null;
}

interface Folk {
	channel: SlackChannel;
	look: string;
	walker: Walker;
	spot: number;
	at: Point;
	badge: { label: string; mentions: boolean; container: Phaser.GameObjects.Container };
	sign?: Phaser.GameObjects.Container;
	/** Fading in (to 1) or out (to 0, then gone). */
	fade?: { to: 0 | 1; tween: Phaser.Tweens.Tween };
	leaving: boolean;
	/** When it next looks about, and when it looks back to the room (scene time, ms). */
	lookAbout: number;
	lookBack?: number;
}

/** What the scene gives the square: walking up to someone, the place, and where the pointer is. */
export interface SquareHooks {
	place(): PlaceData;
	/** Walk up to whoever stands at `at`, then act. */
	approach(at: Point, then: () => void): void;
	/** The pointer over the world, in tiles; undefined when it is off the canvas. */
	pointer(): Point | undefined;
	/** Slack changed: lay the square out again (the scene calls `arrange` with the spots agents left free). */
	changed(): void;
	notify(text: string): void;
	/** The place's wandering (ticket 07): townsfolk stroll between its points of interest and come back. */
	wander?: Wander;
	/** The place's key: each place keeps which spot each channel held there. */
	key(): string;
	/**
	 * How many channels stand in the square before this place (the street): the first so many are there, and this place
	 * holds the next ones. The square itself holds the first.
	 */
	before?(): number;
}

/** A `#rrggbb` colour as a number, for Phaser's fills. */
const hex = (colour: string) => Number.parseInt(colour.slice(1), 16);

let measure: CanvasRenderingContext2D | undefined;
/** Where a label's ink is, from its alphabetic baseline and its left edge: so a number sits truly in the middle. */
function inkBox(text: string, font: string) {
	measure ??= document.createElement("canvas").getContext("2d")!;
	measure.font = font;
	const m = measure.measureText(text);
	return {
		left: -m.actualBoundingBoxLeft,
		right: m.actualBoundingBoxRight,
		ascent: m.actualBoundingBoxAscent,
		descent: m.actualBoundingBoxDescent,
	};
}

/**
 * The unread badge: a small speech bubble (a channel is a conversation) with the count centred on its ink, not on its
 * line box, so `1` and `88` sit in the middle alike. In the theme's bark colours; a channel that mentions the operator
 * wears the asking colour instead. It does not pulse: the square stays calm. Its tail's tip is at (0, 0).
 */
export function drawUnreadBadge(scene: Phaser.Scene, label: string, mentioned: boolean): Phaser.GameObjects.Container {
	const { world } = worn();
	const paper = hex(mentioned ? world.badge.asking.fill : world.bark.paper);
	const light = hex(mentioned ? world.badge.asking.light : world.bark.paper);
	const ink = mentioned ? world.badge.asking.ink : world.bark.ink;
	const outline = hex(mentioned ? world.badge.edge : world.bark.outline);
	const size = 12;
	const css = `bold ${size}px ${world.font}`;
	const box = inkBox(label, css);
	const inkWidth = box.right - box.left;
	const h = 19;
	const w = Math.max(h, Math.ceil(inkWidth + 13));
	const tail = 5;
	const top = -tail - h;
	const g = scene.add.graphics();
	g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2 + 1, top + 2, w, h, h / 2);
	g.fillStyle(outline, 1).fillRoundedRect(-w / 2 - 1.5, top - 1.5, w + 3, h + 3, h / 2 + 1.5);
	// The tail leans toward the head below, off centre as a speech bubble's does.
	g.fillStyle(outline, 1).fillTriangle(-5.5, -tail - 1, 3.5, -tail - 1, -3.5, 1.2);
	g.fillStyle(paper, 1).fillRoundedRect(-w / 2, top, w, h, h / 2);
	g.fillStyle(paper, 1).fillTriangle(-3.8, -tail - 1.5, 1.8, -tail - 1.5, -3.1, -1.2);
	if (light !== paper) g.fillStyle(light, 0.55).fillRoundedRect(-w / 2 + 3, top + 2, w - 6, h / 2 - 2, h / 4);
	const text = scene.add
		.text(0, 0, label, { fontFamily: world.font, fontStyle: "bold", fontSize: `${size}px`, color: ink })
		.setResolution(4)
		.setOrigin(0, 0);
	// Phaser draws the line's baseline `ascent` below the text's top; put the ink's middle on the bubble's middle.
	const ascent = text.getTextMetrics().ascent;
	const middle: Point = [0, top + h / 2];
	text.setPosition(
		Math.round((middle[0] - (box.left + inkWidth / 2)) * 4) / 4,
		Math.round((middle[1] - (ascent + (box.descent - box.ascent) / 2)) * 4) / 4,
	);
	return scene.add.container(0, 0, [g, text]);
}

export interface SignView {
	/** The door the sign hangs over, and the kind of place it leads to. */
	door: string;
	to: string;
	/** The name lettered on it (before the theme's capitals, if it sets them). */
	text: string;
	/** Its letters' size, px at zoom 1. */
	size: number;
	/** The sign board (tiles), and the lettering's box on it. */
	board: Rect;
	ink: Rect;
	/** The world draws the board too (the painting has none, or one too small for a name). */
	plate: boolean;
}

/** A sign's letters, px at zoom 1: as large as the board takes up to the first, never below the second. */
const SIGN_FONT = [18, 10] as const;
/** How much larger than the street's smallest a sign's letters may be. */
const SIGN_KIN = 1.25;
/** The board kept clear around the letters, as a fraction of its height (above and below) and px (at the sides). */
const SIGN_PAD = { y: 0.1, x: 4 };
/** The rim of a board the world draws, px. */
const PLATE_RIM = 2.5;

/** A place's name as a sign says it: without its article ("The forge" is signed "Forge"). */
export function signName(label: string): string {
	const name = label.replace(/^the\s+/i, "");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Letter each building's name on its sign board over its door (`door.sign`), in the theme's sign style: on one line at
 * the largest size the board takes, else on two at the largest legible size. Where the sign asks for a plate, the board
 * is drawn first, in the theme's plate colours (the fantasy square paints boards too small to letter, or none).
 */
export function drawSigns(scene: Phaser.Scene, doors: Door[], theme: Theme): SignView[] {
	const style = theme.world.sign ?? { font: theme.world.font, ink: theme.world.tag.ink, shadow: undefined };
	const plateStyle = theme.world.sign?.plate ?? {
		fill: theme.world.tag.plate,
		rim: theme.world.tag.rim,
		edge: "#000000",
	};
	const views: SignView[] = [];
	const letters: { door: Door; name: string; text: Phaser.GameObjects.Text; size: number; lines: string }[] = [];
	for (const door of doors) {
		if (!door.sign) continue;
		const [x, y, w, h] = door.sign.rect;
		const plate = !!door.sign.plate;
		const name = signName(theme.labels[door.to] ?? door.name);
		if (plate) drawPlate(scene, door.sign.rect, plateStyle);
		// On a drawn plate the letters may come up to its rim; on a painted board they keep clear of its frame.
		const roomW = w * TILE - 2 * (SIGN_PAD.x + (plate ? PLATE_RIM : 0));
		const roomH = plate ? h * TILE - 2 * (PLATE_RIM + 0.5) : h * TILE * (1 - 2 * SIGN_PAD.y);
		const text = scene.add
			.text((x + w / 2) * TILE, (y + h / 2) * TILE, "", {
				fontFamily: style.font,
				fontStyle: "bold",
				color: style.ink,
				align: "center",
				lineSpacing: -2,
			})
			.setOrigin(0.5)
			.setResolution(4)
			.setDepth(-1.1);
		if (style.shadow) text.setShadow(0, 1, style.shadow, 1, false, true);
		const shown = theme.world.sign?.upper ? name.toUpperCase() : name;
		const fits = (lines: string, size: number) => {
			text.setFontSize(size).setText(lines);
			return text.width <= roomW && text.height <= roomH;
		};
		const words = shown.split(" ");
		const twoLines =
			words.length > 1
				? words
						.slice(1)
						.map((_, i) => `${words.slice(0, i + 1).join(" ")}\n${words.slice(i + 1).join(" ")}`)
						.sort(
							(a, b) =>
								Math.max(...a.split("\n").map((l) => l.length)) - Math.max(...b.split("\n").map((l) => l.length)),
						)[0]
				: undefined;
		let size = 0;
		let lines = shown;
		for (let s = SIGN_FONT[0]; s >= SIGN_FONT[1] && !size; s -= 0.5) if (fits(shown, s)) size = s;
		if (!size && twoLines)
			for (let s = SIGN_FONT[0]; s >= SIGN_FONT[1] && !size; s -= 0.5)
				if (fits(twoLines, s)) {
					size = s;
					lines = twoLines;
				}
		if (!size) {
			// Too long for the board at a legible size: the smallest legible size, drawn narrower to fit.
			size = SIGN_FONT[1];
			fits(shown, size);
			text.setScale(Math.min(1, roomW / text.width), Math.min(1, roomH / text.height));
		}
		letters.push({ door, name, text, size, lines });
	}
	// One street's signs read as a set: none lettered much larger than the smallest ("Inn" on a board made for
	// "Library" would shout).
	const most = Math.min(...letters.map((l) => l.size)) * SIGN_KIN;
	for (const { door, name, text, size, lines } of letters) {
		const [x, y, w, h] = door.sign!.rect;
		text.setFontSize(Math.min(size, most)).setText(lines);
		const iw = text.displayWidth / TILE;
		const ih = text.displayHeight / TILE;
		views.push({
			door: door.name,
			to: door.to,
			text: name,
			size: Math.min(size, most) * Math.min(text.scaleX, text.scaleY),
			board: door.sign!.rect,
			ink: [x + w / 2 - iw / 2, y + h / 2 - ih / 2, iw, ih],
			plate: !!door.sign!.plate,
		});
	}
	return views;
}

/** A board where the painting has none fit to letter: a dark edge, a rim, its face, lit a little from above. */
function drawPlate(scene: Phaser.Scene, [x, y, w, h]: Rect, style: { fill: string; rim: string; edge: string }) {
	const px = x * TILE;
	const py = y * TILE;
	const pw = w * TILE;
	const ph = h * TILE;
	const r = Math.min(4, ph / 4);
	const g = scene.add.graphics().setDepth(-1.2);
	g.fillStyle(0x000000, 0.35).fillRoundedRect(px + 1, py + 2, pw, ph, r);
	g.fillStyle(hex(style.edge), 1).fillRoundedRect(px - 1, py - 1, pw + 2, ph + 2, r + 1);
	g.fillStyle(hex(style.rim), 1).fillRoundedRect(px, py, pw, ph, r);
	g.fillStyle(0xffffff, 0.18).fillRoundedRect(px + 1, py + 0.5, pw - 2, 1.2, 0.5);
	const rim = PLATE_RIM;
	g.fillStyle(hex(style.edge), 1).fillRoundedRect(
		px + rim - 0.75,
		py + rim - 0.75,
		pw - 2 * rim + 1.5,
		ph - 2 * rim + 1.5,
		2,
	);
	g.fillStyle(hex(style.fill), 1).fillRoundedRect(px + rim, py + rim, pw - 2 * rim, ph - 2 * rim, 1.5);
	g.fillStyle(0xffffff, 0.06).fillRect(px + rim + 1, py + rim + 1, pw - 2 * rim - 2, (ph - 2 * rim) * 0.4);
	return g;
}

/** The townsfolk of the town square and what they do; the scene owns one while it shows the square. */
export class SquareLife {
	private readonly scene: Phaser.Scene;
	private readonly hooks: SquareHooks;
	private folk = new Map<string, Folk>();
	/** Which spot each channel held, by place, for as long as the app runs (a revisit puts everyone back). */
	private static held = new Map<string, Map<string, number>>();
	private readonly stop: () => void;
	private lastChannels = slack.get().channels;
	private lastStatus = slack.get().status;

	constructor(scene: Phaser.Scene, hooks: SquareHooks) {
		this.scene = scene;
		this.hooks = hooks;
		this.stop = slack.subscribe(() => {
			const { channels, status } = slack.get();
			if (channels === this.lastChannels && status === this.lastStatus) return;
			this.lastChannels = channels;
			this.lastStatus = status;
			this.hooks.changed();
		});
		// Coming into the square reads Slack again, unless it was read just now.
		void slack.refresh();
	}

	/** A new theme lays the square out its own way. */
	static forget() {
		SquareLife.held.clear();
		keptLooks.clear();
	}

	/** Stand the channels with unread messages on the free spots (`free`, indexes into the place's spots). */
	arrange(free: number[], animate: boolean) {
		const theme = worn();
		const place = this.hooks.place();
		const signedIn = slack.get().status === "signed-in";
		const channels = (signedIn ? slack.get().channels : []).slice(this.hooks.before?.() ?? 0);
		const key = this.hooks.key();
		const held = SquareLife.held.get(key) ?? new Map<string, number>();
		SquareLife.held.set(key, held);
		const spots = townsfolkSpots(channels, free, held);
		const byId = new Map(channels.map((channel) => [channel.id, channel]));
		for (const [id, folk] of this.folk) if (!spots.has(id) && !folk.leaving) this.leave(folk, animate);
		const standing = new Map(
			[...this.folk].filter(([id, folk]) => spots.has(id) && !folk.leaving).map(([id, folk]) => [id, folk.look]),
		);
		const looks = chooseTownsfolkLooks(townsfolkChoices(theme), [...spots.keys()], standing, keptLooks);
		for (const [id, look] of looks) keptLooks.set(id, look);
		for (const [id, spot] of spots) {
			const channel = byId.get(id)!;
			const at = place.spots[spot];
			let folk = this.folk.get(id);
			if (folk?.leaving && folk.look !== looks.get(id)) {
				// Coming back while fading out, but its look is someone else's now: the fading one goes, a new one comes.
				this.folk.delete(id);
				folk = undefined;
			}
			if (folk?.leaving) {
				folk.fade?.tween.remove();
				folk.leaving = false;
				this.fade(folk, 1);
			}
			if (!folk) {
				const look = looks.get(id);
				if (!look) continue;
				const walker = new Walker(this.scene, look, theme.looks[look], at, "down");
				folk = {
					channel,
					look,
					walker,
					spot,
					at,
					badge: this.badge(channel),
					leaving: false,
					lookAbout: this.scene.time.now + Phaser.Math.Between(...LOOK_ABOUT_MS),
				};
				this.folk.set(id, folk);
				// Standing about, it idles now and then and strolls to the square's points of interest (06, 07).
				const standing = folk;
				walker.live(id);
				this.hooks.wander?.add(id, "townsfolk", walker, () => (standing.leaving ? undefined : standing.at));
				if (animate) {
					walker.setAlpha(0);
					folk.badge.container.setAlpha(0);
					this.fade(folk, 1);
				}
			} else if (folk.spot !== spot) {
				// Another spot (an agent took its own): it walks there.
				folk.spot = spot;
				folk.at = at;
				const others = this.occupied().filter((p) => p !== at);
				const path = findPath(gridFor(place, others), [folk.walker.x, folk.walker.y], [at]);
				folk.walker.walk(path ? [...path.points, at] : [[folk.walker.x, folk.walker.y], at], () =>
					folk?.walker.face([at[0], at[1] + 1]),
				);
			}
			folk.channel = channel;
			const label = unreadLabel(channel);
			if (label !== folk.badge.label || channel.mentions > 0 !== folk.badge.mentions) {
				folk.badge.container.destroy();
				folk.badge = this.badge(channel);
			}
		}
		for (const [id, spot] of spots) held.set(id, spot);
	}

	/** Where townsfolk stand (the avatar and the agents walk round them). */
	occupied(): Point[] {
		return [...this.folk.values()].filter((folk) => !folk.leaving).map((folk) => folk.at);
	}

	update(delta: number, ui: number) {
		const time = this.scene.time.now;
		const pointer = this.hooks.pointer();
		const hovered = pointer ? this.under(pointer)[0] : undefined;
		for (const folk of this.folk.values()) {
			const { walker } = folk;
			walker.update(delta);
			const depth = 1e5 + walker.y;
			folk.badge.container
				.setPosition(walker.x * TILE + 3, (walker.y - BADGE_LIFT) * TILE)
				.setDepth(depth)
				.setScale(ui)
				.setAlpha(walker.sprite.alpha);
			const signed = folk === hovered && !folk.leaving;
			if (signed && !folk.sign) folk.sign = drawTag(this.scene, channelTitle(folk.channel));
			if (!signed && folk.sign) {
				folk.sign.destroy();
				folk.sign = undefined;
			}
			folk.sign
				?.setPosition(walker.x * TILE, (walker.y - SIGN_LIFT) * TILE - 6 * (ui - 1))
				.setDepth(depth + 0.5)
				.setScale(ui);
			// Looking about: a glance to the side now and then, and back to the room (at its spot, not out strolling).
			if (walker.moving || folk.leaving || Math.hypot(walker.x - folk.at[0], walker.y - folk.at[1]) > 0.05) continue;
			if (folk.lookBack !== undefined && time >= folk.lookBack) {
				folk.lookBack = undefined;
				walker.face([folk.at[0], folk.at[1] + 1]);
			} else if (folk.lookBack === undefined && time >= folk.lookAbout) {
				folk.lookAbout = time + Phaser.Math.Between(...LOOK_ABOUT_MS);
				folk.lookBack = time + Phaser.Math.Between(...LOOK_AWAY_MS);
				walker.face([folk.at[0] + (Math.random() < 0.5 ? -1 : 1), folk.at[1] + 0.2]);
			}
		}
	}

	/** Townsfolk under a point, front first, with what can be done with each. */
	targetsAt(point: Point): Target[] {
		return this.under(point).map((folk) => this.target(folk));
	}

	views(): TownsfolkView[] {
		return [...this.folk.values()]
			.filter((folk) => !folk.leaving)
			.map(({ channel, look, walker, badge, sign }) => ({
				idle: walker.view().idle,
				id: channel.id,
				name: channelTitle(channel),
				look,
				x: walker.x,
				y: walker.y,
				moving: walker.moving,
				badge: badge.label,
				mentions: channel.mentions,
				sign: !!sign,
				alpha: walker.sprite.alpha,
			}));
	}

	destroy() {
		this.stop();
		for (const folk of this.folk.values()) this.drop(folk);
		this.folk.clear();
	}

	private under([x, y]: Point): Folk[] {
		const scale = (PERSON_TILES * TILE) / STANDING / TILE;
		return [...this.folk.values()]
			.filter(({ walker, leaving }) => {
				if (leaving) return false;
				const half = Math.min(0.42, (walker.sprite.width * scale) / 2);
				return Math.abs(x - walker.x) <= half && y >= walker.y - PERSON_TILES * 0.97 && y <= walker.y + 0.15;
			})
			.sort((a, b) => b.walker.y - a.walker.y);
	}

	private target(folk: Folk): Target {
		const name = channelTitle(folk.channel);
		const read = () => squarePanels.openChannel(folk.channel, folk.look);
		const theme = worn();
		const who = theme.labels.townsfolk ?? "Townsperson";
		const count = folk.channel.unread === null ? "unread messages" : `${unreadLabel(folk.channel)} unread`;
		const mentions = folk.channel.mentions ? `, ${folk.channel.mentions} mentioning you` : "";
		const actions: Action[] = [
			action("Read", () => this.hooks.approach(folk.at, read), name, "character"),
			action("Examine", () => this.hooks.notify(`${who} for ${name}: ${count}${mentions}.`), name, "character"),
		];
		return { name, tone: "character", actions };
	}

	private badge(channel: SlackChannel): Folk["badge"] {
		const label = unreadLabel(channel);
		const mentions = channel.mentions > 0;
		return { label, mentions, container: drawUnreadBadge(this.scene, label, mentions) };
	}

	private fade(folk: Folk, to: 0 | 1, then?: () => void) {
		folk.fade?.tween.remove();
		const from = folk.walker.sprite.alpha;
		const tween = this.scene.tweens.addCounter({
			from,
			to,
			duration: FADE_MS * Math.abs(to - from),
			ease: "Sine.inOut",
			onUpdate: (counter) => folk.walker.setAlpha(counter.getValue() ?? to),
			onComplete: () => {
				folk.fade = undefined;
				then?.();
			},
		});
		folk.fade = { to, tween };
	}

	/** Its channel was read elsewhere, or an agent needs the spot: it fades away where it stands. */
	private leave(folk: Folk, animate: boolean) {
		folk.leaving = true;
		folk.sign?.destroy();
		folk.sign = undefined;
		const gone = () => {
			if (!folk.leaving) return;
			this.drop(folk);
			if (this.folk.get(folk.channel.id) === folk) this.folk.delete(folk.channel.id);
		};
		if (animate) this.fade(folk, 0, gone);
		else gone();
	}

	private drop(folk: Folk) {
		folk.fade?.tween.remove();
		folk.badge.container.destroy();
		folk.sign?.destroy();
		folk.walker.destroy();
	}
}
