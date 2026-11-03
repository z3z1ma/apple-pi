import * as Phaser from "phaser";
import type { CiState, PullRequest } from "../../../src/integrations.js";
import { forge, prKey } from "../../overlay/places/forge-state.js";
import { type OverlaySlot, type PlaceData, type Point, type Rect, say, TILE } from "../../theme.js";
import { worn } from "../../theme-store.js";
import { action, type Target } from "../actions.js";
import { drawTag } from "../character-life.js";

const ART: Record<CiState, string> = {
	passing: "overlay:blade-passing",
	failing: "overlay:blade-failing",
	running: "overlay:blade-running",
	none: "overlay:blade-passing",
};

const FADE_MS = 420;

const SIGN_LIFT = 0.12;

const SIGN_TITLE = 42;

const TURNED_THICKNESS = 0.3;

export interface WorkView {
	key: string;
	repo: string;
	number: number;
	ci: CiState;

	x: number;
	y: number;

	art: string;
	alpha: number;

	sign: boolean;
}

interface Piece {
	pr: PullRequest;
	slot: OverlaySlot;
	image: Phaser.GameObjects.Image;
	glow?: Phaser.GameObjects.Image;
	pulse?: Phaser.Tweens.Tween;
	rect: Rect;
	going: boolean;
}

export interface ForgeHost {
	place(): PlaceData;

	walkUp(at: Point, then: () => void): void;

	pointer(): Point | undefined;

	caption(line: string | undefined): void;

	uiScale(): number;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text);

export class ForgeBenches {
	private readonly scene: Phaser.Scene;
	private readonly host: ForgeHost;
	private pieces = new Map<string, Piece>();
	private sign?: { key: string; tag: Phaser.GameObjects.Container };
	private rack?: string;
	private readonly stop: () => void;

	constructor(scene: Phaser.Scene, host: ForgeHost) {
		this.scene = scene;
		this.host = host;
		this.stop = forge.subscribe(() => this.lay());
		this.lay(false);
		forge.enter();
	}

	destroy() {
		this.stop();
		forge.leave();
	}

	private slots(): OverlaySlot[] {
		return this.host.place().overlaySlots.filter((slot) => slot.kind === "work");
	}

	private lay(animate = true) {
		const list = forge.get().list;
		const slots = this.slots();
		const shown = list.pullRequests.slice(0, slots.length);
		const keys = new Set(shown.map(prKey));
		for (const [key, piece] of this.pieces) if (!keys.has(key)) this.remove(key, piece, animate);

		const taken = new Set([...this.pieces.values()].filter((p) => !p.going).map((p) => p.slot));
		const free = slots.filter((slot) => !taken.has(slot));
		for (const pr of shown) {
			const key = prKey(pr);
			const piece = this.pieces.get(key);
			if (piece && !piece.going) {
				piece.pr = pr;
				this.dress(piece);
				continue;
			}
			const slot = free.shift();
			if (slot) this.add(key, pr, slot, animate);
		}
		this.showRack(list.pullRequests.length - shown.length, list.state === "failed" && !list.pullRequests.length);
	}

	private benchFeet([x, y]: Point): number {
		const bench = this.host
			.place()
			.foreground?.find(
				({ rect: [rx, ry, rw, rh] }) => x >= rx && x <= rx + rw && y - 0.05 >= ry && y - 0.05 <= ry + rh,
			);
		return bench ? bench.feet : y;
	}

	private add(key: string, pr: PullRequest, slot: OverlaySlot, animate: boolean) {
		const [x, y] = slot.at;
		const depth = this.benchFeet(slot.at) * TILE + 0.2;
		const image = this.scene.add.image(0, 0, ART[pr.ci]).setDepth(depth);
		image.setScale(((slot.w ?? 1.5) * TILE) / image.width);
		const piece: Piece = { pr, slot, image, rect: [x, y, 0, 0], going: false };
		this.place(piece);
		this.pieces.set(key, piece);
		this.dress(piece);
		if (animate) {
			const alpha = image.alpha;
			const rest = image.y;
			image.setAlpha(0);
			image.y -= 6;
			this.scene.tweens.add({ targets: image, alpha, y: rest, duration: FADE_MS, ease: "Cubic.out" });
		}
	}

	private place(piece: Piece) {
		const { image, slot } = piece;
		const [x, y] = slot.at;
		const turn = Phaser.Math.DegToRad(slot.turn ?? 0);
		const w = image.displayWidth / TILE;
		const h = image.displayHeight / TILE;

		const across = turn ? w * Math.abs(Math.cos(turn)) + h * Math.abs(Math.sin(turn)) : w;
		const down = turn ? Math.abs(h * Math.cos(turn) - w * Math.sin(turn)) + TURNED_THICKNESS : h;
		image.setOrigin(0.5).setRotation(turn);
		image.setPosition(x * TILE, (y - down / 2) * TILE);
		piece.rect = [x - across / 2, y - down, across, down];
	}

	private remove(key: string, piece: Piece, animate: boolean) {
		piece.going = true;
		const done = () => {
			piece.pulse?.remove();
			piece.glow?.destroy();
			piece.image.destroy();
			if (this.pieces.get(key) === piece) this.pieces.delete(key);
		};
		if (this.sign?.key === key) this.hideSign();
		if (!animate) return done();
		piece.pulse?.remove();
		this.scene.tweens.add({
			targets: [piece.image, piece.glow].filter(Boolean),
			alpha: 0,
			duration: FADE_MS,
			ease: "Cubic.in",
			onComplete: done,
		});
	}

	private dress(piece: Piece) {
		const { pr, image } = piece;
		if (image.texture.key !== ART[pr.ci]) {
			image.setTexture(ART[pr.ci]);
			image.setScale(((piece.slot.w ?? 1.5) * TILE) / image.width);
			this.place(piece);
		}
		if (pr.ci === "none") image.setTint(0xcfcac2);
		else image.clearTint();
		image.setAlpha(pr.draft ? 0.78 : 1);
		const glowing = pr.ci === "running" || pr.ci === "failing";
		if (glowing && !piece.glow) {
			const [x, y, w, h] = piece.rect;
			const glow = this.scene.add
				.image((x + w / 2) * TILE, (y + h * 0.55) * TILE, this.glowTexture())
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(image.depth - 0.05)
				.setAlpha(0);
			glow.setScale((Math.max(w, h) * 1.25 * TILE) / glow.width, (h * 1.1 * TILE) / glow.height);
			piece.glow = glow;
		}
		if (piece.glow) {
			piece.pulse?.remove();
			if (!glowing) {
				piece.glow.destroy();
				piece.glow = undefined;
				return;
			}
			const running = pr.ci === "running";
			piece.glow.setTint(running ? 0xffb347 : 0xff5a3c);
			piece.glow.setAlpha(running ? 0.22 : 0.12);
			piece.pulse = this.scene.tweens.add({
				targets: piece.glow,
				alpha: running ? 0.5 : 0.26,
				duration: running ? 900 : 1700,
				yoyo: true,
				repeat: -1,
				ease: "Sine.inOut",
			});
		}
	}

	private glowTexture(): string {
		const key = "glow:work";
		if (this.scene.textures.exists(key)) return key;
		const size = 96;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d")!;
		const light = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		light.addColorStop(0, "rgba(255,255,255,0.9)");
		light.addColorStop(0.35, "rgba(255,255,255,0.35)");
		light.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = light;
		ctx.fillRect(0, 0, size, size);
		this.scene.textures.addCanvas(key, canvas);
		return key;
	}

	private showRack(more: number, failed: boolean) {
		const line = failed ? "GitHub can\u2019t be read" : more > 0 ? say(worn(), "forge-more", { count: more }) : "";
		if (this.rack === line) return;
		this.rack = line;
		this.host.caption(line || undefined);
	}

	private piecesAt([x, y]: Point): Piece[] {
		return [...this.pieces.values()]
			.filter(({ rect: [rx, ry, rw, rh], going }) => !going && x >= rx && x < rx + rw && y >= ry && y < ry + rh)
			.sort((a, b) => b.slot.at[1] - a.slot.at[1]);
	}

	targetsAt(point: Point): Target[] {
		return this.piecesAt(point).map(({ pr, slot }) => {
			const name = `#${pr.number} ${cut(pr.title, SIGN_TITLE)}`;
			const front: Point = [slot.at[0], this.benchFeet(slot.at) + 0.45];
			return {
				name,
				tone: "object",
				actions: [
					action("Look over", () => this.host.walkUp(front, () => forge.openCard(pr)), name, "object"),
					action("Review", () => forge.openReview(pr), name, "object"),
					action("Open in GitHub", () => void forge.openInGitHub(pr), name, "object"),
				],
			};
		});
	}

	update() {
		const at = this.host.pointer();
		const over = at ? this.piecesAt(at)[0] : undefined;
		const key = over ? prKey(over.pr) : undefined;
		if (key !== this.sign?.key) {
			this.hideSign();
			if (over && key) this.showSign(key, over);
		}
		const scale = this.host.uiScale();
		this.sign?.tag.setScale(scale);
	}

	private showSign(key: string, piece: Piece) {
		const { pr, rect } = piece;
		const ci = { passing: "passing", failing: "failing", running: "running", none: "no checks" }[pr.ci];
		const tag = drawTag(this.scene, `#${pr.number} \u00b7 ${ci}`);
		tag.setPosition((rect[0] + rect[2] / 2) * TILE, (rect[1] - SIGN_LIFT) * TILE).setDepth(9.7e4);
		this.sign = { key, tag };
	}

	private hideSign() {
		this.sign?.tag.destroy();
		this.sign = undefined;
	}

	views(): WorkView[] {
		return [...this.pieces.entries()]
			.filter(([, piece]) => !piece.going)
			.map(([key, { pr, slot, image }]) => ({
				key,
				repo: pr.repo,
				number: pr.number,
				ci: pr.ci,
				x: slot.at[0],
				y: slot.at[1],
				art: image.texture.key.replace(/^overlay:/, ""),
				alpha: image.alpha,
				sign: this.sign?.key === key,
			}));
	}
}
