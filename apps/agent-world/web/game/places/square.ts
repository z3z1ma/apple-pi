// The town square's townsfolk (ticket 27): each Slack channel with unread messages stands in the square as a
// townsperson, in one of the theme's `townsfolk` looks chosen by the channel's id, with a small unread badge over its
// head and the channel's name on a sign while the pointer is over it. Talking to one reads its channel; the crier (the
// square's host) reaches every other channel. Agents come first: townsfolk stand only on painted spots no agent
// holds, so the square never holds more people than its painting was laid out for (the bound, see this file's
// context file).
import * as Phaser from "phaser";
import type { SlackChannel } from "../../../src/integrations.js";
import { channelTitle, slack, unreadLabel } from "../../overlay/places/slack-state.js";
import { squarePanels } from "../../overlay/places/square-panels.js";
import { type PlaceData, type Point, type Theme, TILE } from "../../theme.js";
import { worn } from "../../theme-store.js";
import { type Action, action, type Target } from "../actions.js";
import { drawTag } from "../character-life.js";
import { findPath, gridFor } from "../pathing.js";
import { PERSON_TILES, Walker } from "../walker.js";

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

/** The townsfolk look a channel wears: fixed by its id, so a channel is always the same person. */
export function townsfolkLook(theme: Theme, channelId: string): string | undefined {
	const choices = Object.entries(theme.looks)
		.filter(([, look]) => look.role === "townsfolk")
		.map(([name]) => name)
		.sort();
	return choices.length ? choices[hash(channelId) % choices.length] : undefined;
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

/** The townsfolk of the town square and what they do; the scene owns one while it shows the square. */
export class SquareLife {
	private readonly scene: Phaser.Scene;
	private readonly hooks: SquareHooks;
	private folk = new Map<string, Folk>();
	/** Which spot each channel held, for as long as the app runs (a revisit puts everyone back). */
	private static held = new Map<string, number>();
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
	}

	/** Stand the channels with unread messages on the free spots (`free`, indexes into the place's spots). */
	arrange(free: number[], animate: boolean) {
		const theme = worn();
		const place = this.hooks.place();
		const signedIn = slack.get().status === "signed-in";
		const channels = signedIn ? slack.get().channels : [];
		const spots = townsfolkSpots(channels, free, SquareLife.held);
		const byId = new Map(channels.map((channel) => [channel.id, channel]));
		for (const [id, folk] of this.folk) if (!spots.has(id) && !folk.leaving) this.leave(folk, animate);
		for (const [id, spot] of spots) {
			const channel = byId.get(id)!;
			const at = place.spots[spot];
			let folk = this.folk.get(id);
			if (folk?.leaving) {
				folk.fade?.tween.remove();
				folk.leaving = false;
				this.fade(folk, 1);
			}
			if (!folk) {
				const look = townsfolkLook(theme, id);
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
		for (const [id, spot] of spots) SquareLife.held.set(id, spot);
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
			// Looking about: a glance to the side now and then, and back to the room.
			if (walker.moving || folk.leaving) continue;
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
