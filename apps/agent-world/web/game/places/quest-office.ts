// The quest office's board (ticket 24): each Jira issue assigned to the operator is a notice pinned on the board in the
// theme's art, as pressing as it is (`notice-urgent` for a high priority, `notice-progress` once work started,
// `notice-done`, else `notice-open`). Notices fill the place's `notice` slots, the most pressing first; the rest wait
// at the counter (a tag over the clerk, and the clerk's list). Before sign-in the board stays bare and says so. Hovering
// a notice names it on a small sign; reading it walks to the board and opens the issue. The list is read on entering and
// every minute while the operator is here.
import type * as Phaser from "phaser";
import type { JiraIssue } from "../../../src/integrations.js";
import { atlassian, type NoticeKind, noticeOf } from "../../overlay/places/atlassian-state.js";
import { type OverlaySlot, type PlaceData, type Point, type Rect, say, TILE } from "../../theme.js";
import { worn } from "../../theme-store.js";
import { action, type Target } from "../actions.js";
import { drawTag } from "../character-life.js";

/** How often the board is read again while the operator is in the office (ms). */
const REFRESH_MS = 60_000;
/** How a notice is pinned up, or taken down (ms). */
const PIN_MS = 380;
/** The sign over a hovered notice, in tiles above its top; longest summary on it. */
const SIGN_LIFT = 0.1;
const SIGN_SUMMARY = 38;
/** The tag for issues beyond the board: how far below the lowest notices (tiles), whose height is about this × width. */
const COUNTER_DROP = 0.42;
const NOTICE_ASPECT = 1.3;
/** How wide the key's slip may be at most, as a part of the notice's width. */
const KEY_SLIP = 1.3;
/** How far a notice tilts at most (radians), by its key, so the board looks pinned by hand. */
const TILT = 0.045;

export interface NoticeView {
	key: string;
	kind: NoticeKind;
	/** Its centre, in tiles. */
	x: number;
	y: number;
	/** The paper as drawn, in tiles: its opaque bounds (pins included), unturned and unlifted. */
	paper: Rect;
	alpha: number;
	/** Its sign shows (the pointer is over it). */
	sign: boolean;
}

export interface QuestOfficeHost {
	place(): PlaceData;
	/** Walk to the floor nearest a point (under the board), face it, then act. */
	walkUp(at: Point, then: () => void): void;
	/** Where the pointer is over the world, in tiles. */
	pointer(): Point | undefined;
	/** The view's zoom correction for things drawn at a steady size on screen. */
	uiScale(): number;
}

interface Notice {
	issue: JiraIssue;
	kind: NoticeKind;
	slot: OverlaySlot;
	image: Phaser.GameObjects.Image;
	label: Phaser.GameObjects.Container;
	rect: Rect;
	going: boolean;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text);
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/** Each notice texture's opaque part, as fractions of it: what shows of the notice on the board. */
const opaque = new Map<string, Rect>();

/**
 * The notice sprite as pinned: the pack's `world.notice.paper` part of it, with the board around the paper cut away
 * when the pack asks (`cutOut`: whatever touches the part's edge and looks like the board). Made once per pack.
 */
export function noticeTexture(scene: Phaser.Scene, kind: NoticeKind): string {
	const key = `notice:${kind}`;
	if (scene.textures.exists(key)) return key;
	const source = scene.textures.get(`overlay:notice-${kind}`).getSourceImage() as HTMLImageElement;
	const notice = worn().world.notice;
	const [fx, fy, fw, fh] = notice?.paper ?? [0, 0, 1, 1];
	const sx = Math.round(fx * source.width);
	const sy = Math.round(fy * source.height);
	const w = Math.max(1, Math.round(fw * source.width));
	const h = Math.max(1, Math.round(fh * source.height));
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
	ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
	if (notice?.cutOut) cutAway(ctx, w, h);
	opaque.set(key, opaqueBounds(ctx, w, h));
	scene.textures.addCanvas(key, canvas);
	return key;
}

function opaqueBounds(ctx: CanvasRenderingContext2D, w: number, h: number): Rect {
	const px = ctx.getImageData(0, 0, w, h).data;
	let [left, top, right, bottom] = [w, h, -1, -1];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if (px[(y * w + x) * 4 + 3] >= 128) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
	if (right < 0) return [0, 0, 1, 1];
	return [left / w, top / h, (right + 1 - left) / w, (bottom + 1 - top) / h];
}

/**
 * Clear the board around a notice: from every edge pixel, flood through pixels near the edge's own colour (the board
 * painted around the paper) and darker than the paper, and make them transparent.
 */
function cutAway(ctx: CanvasRenderingContext2D, w: number, h: number) {
	const image = ctx.getImageData(0, 0, w, h);
	const px = image.data;
	const edge: number[] = [];
	for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
	for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
	const channel = (c: number) => {
		const values = edge.map((i) => px[i * 4 + c]).sort((a, b) => a - b);
		return values[values.length >> 1];
	};
	const board = [channel(0), channel(1), channel(2)];
	const boardLike = (i: number) => {
		const r = px[i * 4];
		const g = px[i * 4 + 1];
		const b = px[i * 4 + 2];
		const near = Math.hypot(r - board[0], g - board[1], b - board[2]) < 70;
		return near && (r + g + b) / 3 < 175;
	};
	const seen = new Uint8Array(w * h);
	const queue: number[] = [];
	for (const i of edge)
		if (!seen[i] && boardLike(i)) {
			seen[i] = 1;
			queue.push(i);
		}
	while (queue.length) {
		const i = queue.pop()!;
		px[i * 4 + 3] = 0;
		const x = i % w;
		const y = (i - x) / w;
		for (const [nx, ny] of [
			[x + 1, y],
			[x - 1, y],
			[x, y + 1],
			[x, y - 1],
		]) {
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const n = ny * w + nx;
			if (!seen[n] && boardLike(n)) {
				seen[n] = 1;
				queue.push(n);
			}
		}
	}
	ctx.putImageData(image, 0, 0);
}

export class QuestBoard {
	private readonly scene: Phaser.Scene;
	private readonly host: QuestOfficeHost;
	private notices = new Map<string, Notice>();
	private sign?: { key: string; tag: Phaser.GameObjects.Container };
	private counter?: { line: string; tag: Phaser.GameObjects.Container };
	private board?: { line: string; tag: Phaser.GameObjects.Container };
	private readonly stop: () => void;
	private readonly timer: Phaser.Time.TimerEvent;

	constructor(scene: Phaser.Scene, host: QuestOfficeHost) {
		this.scene = scene;
		this.host = host;
		this.stop = atlassian.subscribe(() => this.pin());
		this.pin(false);
		const read = () => {
			void atlassian.refreshStatus();
			void atlassian.loadAssigned();
		};
		read();
		this.timer = scene.time.addEvent({ delay: REFRESH_MS, loop: true, callback: read });
	}

	destroy() {
		this.stop();
		this.timer.remove();
	}

	private slots(): OverlaySlot[] {
		return this.host.place().overlaySlots.filter((slot) => slot.kind === "notice");
	}

	/** Pin the assigned issues: a notice keeps its place while it stays; its art follows its state. */
	private pin(animate = true) {
		const { assigned, signedIn } = atlassian.get();
		const signedOut = signedIn === null || assigned.state === "signed-out";
		const issues = signedOut ? [] : "items" in assigned ? (assigned.items ?? []) : [];
		const slots = this.slots();
		const shown = issues.slice(0, slots.length);
		const keys = new Set(shown.map((issue) => issue.key));
		for (const [key, notice] of this.notices) if (!keys.has(key)) this.unpin(key, notice, animate);
		const taken = new Set([...this.notices.values()].filter((n) => !n.going).map((n) => n.slot));
		const free = slots.filter((slot) => !taken.has(slot));
		for (const issue of shown) {
			const notice = this.notices.get(issue.key);
			if (notice && !notice.going) {
				notice.issue = issue;
				this.dress(notice);
				continue;
			}
			const slot = free.shift();
			if (slot) this.add(issue, slot, animate);
		}
		const more = issues.length - shown.length;
		this.showCounter(more > 0 ? say(worn(), "quest-more", { count: more }) : "");
		this.showBoard(
			signedOut
				? "Sign in to Atlassian in Settings"
				: assigned.state === "failed" && !issues.length
					? "Jira can\u2019t be read"
					: "",
		);
	}

	private add(issue: JiraIssue, slot: OverlaySlot, animate: boolean) {
		const [x, y] = slot.at;
		const kind = noticeOf(issue);
		const image = this.scene.add.image(x * TILE, y * TILE, noticeTexture(this.scene, kind)).setDepth((y + 1) * TILE);
		const w = slot.w ?? 1;
		image.setScale((w * TILE) / image.width);
		image.setRotation(((hash(issue.key) % 1000) / 1000) * TILT);
		const h = image.displayHeight / TILE;
		const label = this.keyLabel(issue.key, w)
			.setPosition(x * TILE, (y + h * 0.04) * TILE)
			.setRotation(image.rotation)
			.setDepth(image.depth + 0.01);
		const notice: Notice = { issue, kind, slot, image, label, rect: [x - w / 2, y - h / 2, w, h], going: false };
		this.notices.set(issue.key, notice);
		if (animate) {
			for (const object of [image, label]) {
				const to = object.y;
				object.setAlpha(0);
				object.y -= 8;
				this.scene.tweens.add({ targets: object, alpha: 1, y: to, duration: PIN_MS, ease: "Back.out" });
			}
		}
	}

	/** The issue's key on a small slip across the notice, so the board reads at a glance. */
	private keyLabel(key: string, w: number): Phaser.GameObjects.Container {
		const { font, tag } = worn().world;
		const text = this.scene.add
			.text(0, 0, key, { fontFamily: font, fontSize: "9px", fontStyle: "bold", color: tag.ink })
			.setResolution(4)
			.setOrigin(0.5, 0.5);
		// A key longer than the paper may stick out a little past its sides, as a slip pinned across it would (notices
		// sized to their board are too narrow for a legible key); longer than that, it is drawn smaller.
		const room = w * TILE * KEY_SLIP - 6;
		if (text.width > room) text.setScale(room / text.width);
		const width = Math.ceil(text.displayWidth + 6);
		const height = Math.ceil(text.displayHeight + 2);
		const slip = this.scene.add.graphics();
		const plate = Number.parseInt(tag.plate.slice(1), 16);
		const rim = Number.parseInt(tag.rim.slice(1), 16);
		slip.fillStyle(0x000000, 0.25).fillRoundedRect(-width / 2 + 0.5, -height / 2 + 1, width, height, 2);
		slip.fillStyle(plate, 0.96).fillRoundedRect(-width / 2, -height / 2, width, height, 2);
		slip.lineStyle(1, rim, 0.8).strokeRoundedRect(-width / 2, -height / 2, width, height, 2);
		return this.scene.add.container(0, 0, [slip, text]);
	}

	private unpin(key: string, notice: Notice, animate: boolean) {
		notice.going = true;
		if (this.sign?.key === key) this.hideSign();
		const done = () => {
			notice.image.destroy();
			notice.label.destroy();
			if (this.notices.get(key) === notice) this.notices.delete(key);
		};
		if (!animate) return done();
		this.scene.tweens.add({
			targets: [notice.image, notice.label],
			alpha: 0,
			y: `+=6`,
			duration: PIN_MS,
			ease: "Cubic.in",
			onComplete: done,
		});
	}

	/** Its art for how pressing it is now. */
	private dress(notice: Notice) {
		const kind = noticeOf(notice.issue);
		if (kind === notice.kind) return;
		notice.kind = kind;
		const width = notice.image.displayWidth;
		notice.image.setTexture(noticeTexture(this.scene, kind));
		notice.image.setScale(width / notice.image.width);
	}

	/**
	 * Under the board: how many more issues wait at the counter than the board has room for. (Over the clerk it hid
	 * under the side panel, which stands on the east side where every pack puts the counter.)
	 */
	private showCounter(line: string) {
		if (this.counter?.line === line) return;
		this.counter?.tag.destroy();
		this.counter = undefined;
		const slots = this.slots();
		if (!line || !slots.length) return;
		const xs = slots.map((slot) => slot.at[0]);
		// Under the notices as drawn (each pack's are their own shape), else under where they would be.
		const pinned = [...this.notices.values()].filter((notice) => !notice.going);
		const bottom = pinned.length
			? Math.max(...pinned.map(({ rect }) => rect[1] + rect[3]))
			: Math.max(...slots.map((slot) => slot.at[1] + ((slot.w ?? 1) * NOTICE_ASPECT) / 2));
		const tag = drawTag(this.scene, line);
		tag.setPosition(((Math.min(...xs) + Math.max(...xs)) / 2) * TILE, (bottom + COUNTER_DROP) * TILE).setDepth(9.6e4);
		this.counter = { line, tag };
	}

	/** On the bare board: why it is bare (not signed in, or Jira could not be read). */
	private showBoard(line: string) {
		if (this.board?.line === line) return;
		this.board?.tag.destroy();
		this.board = undefined;
		const slots = this.slots();
		if (!line || !slots.length) return;
		const xs = slots.map((slot) => slot.at[0]);
		const ys = slots.map((slot) => slot.at[1]);
		const x = (Math.min(...xs) + Math.max(...xs)) / 2;
		const y = (Math.min(...ys) + Math.max(...ys)) / 2;
		const tag = drawTag(this.scene, line);
		tag.setPosition(x * TILE, (y + 0.3) * TILE).setDepth(9.6e4);
		this.board = { line, tag };
	}

	private noticesAt([x, y]: Point): Notice[] {
		return [...this.notices.values()].filter(
			({ rect: [rx, ry, rw, rh], going }) => !going && x >= rx && x < rx + rw && y >= ry && y < ry + rh,
		);
	}

	/** Every notice under a point: read it (the default: walk to the board and open the issue), or open it in Jira. */
	targetsAt(point: Point): Target[] {
		return this.noticesAt(point).map(({ issue, slot }) => {
			const name = `${issue.key} ${cut(issue.summary, SIGN_SUMMARY)}`;
			return {
				name,
				tone: "object" as const,
				actions: [
					action(
						"Read",
						() => this.host.walkUp(slot.at, () => atlassian.open({ kind: "issue", key: issue.key, from: "board" })),
						name,
						"object",
					),
					action("Open in Jira", () => void atlassian.openLink(issue.url), name, "object"),
				],
			};
		});
	}

	/** Each frame: the sign over the notice under the pointer, which lifts a little; tags kept a steady size. */
	update() {
		const at = this.host.pointer();
		const over = at ? this.noticesAt(at)[0] : undefined;
		const key = over?.issue.key;
		if (key !== this.sign?.key) {
			const before = this.sign && this.notices.get(this.sign.key);
			if (before) this.lift(before, false);
			this.hideSign();
			if (over && key) {
				this.lift(over, true);
				this.showSign(key, over);
			}
		}
		const scale = this.host.uiScale();
		this.sign?.tag.setScale(scale);
		this.counter?.tag.setScale(scale);
		this.board?.tag.setScale(scale);
	}

	/** A hovered notice comes forward a little, brighter. */
	private lift(notice: Notice, up: boolean) {
		const base = ((notice.slot.w ?? 1) * TILE) / notice.image.width;
		this.scene.tweens.add({
			targets: notice.image,
			scale: base * (up ? 1.08 : 1),
			duration: 140,
			ease: "Sine.out",
		});
		if (up) notice.image.setTint(0xfff6e6);
		else notice.image.clearTint();
	}

	private showSign(key: string, notice: Notice) {
		const { issue, rect } = notice;
		const tag = drawTag(this.scene, `${issue.key} \u00b7 ${issue.status ?? "open"}`);
		tag.setPosition((rect[0] + rect[2] / 2) * TILE, (rect[1] - SIGN_LIFT) * TILE).setDepth(9.7e4);
		this.sign = { key, tag };
	}

	private hideSign() {
		this.sign?.tag.destroy();
		this.sign = undefined;
	}

	views(): NoticeView[] {
		return [...this.notices.values()]
			.filter((notice) => !notice.going)
			.map(({ issue, kind, slot, image }) => {
				const w = slot.w ?? 1;
				const h = (w * image.height) / image.width;
				const [fx, fy, fw, fh] = opaque.get(image.texture.key) ?? [0, 0, 1, 1];
				const paper: Rect = [slot.at[0] - w / 2 + fx * w, slot.at[1] - h / 2 + fy * h, fw * w, fh * h];
				return { issue, kind, slot, image, paper };
			})
			.map(({ issue, kind, slot, image, paper }) => ({
				key: issue.key,
				kind,
				x: slot.at[0],
				y: slot.at[1],
				paper,
				alpha: image.alpha,
				sign: this.sign?.key === issue.key,
			}));
	}
}
