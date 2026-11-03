import type * as Phaser from "phaser";
import { type Point, TILE } from "../../theme.js";

export type MarkKind = "walk" | "act";

export interface MarkView {
	kind: MarkKind;

	x: number;
	y: number;
	alpha: number;
}

const MARK_PX = 22;
const FADE_MS = 420;

const MARK_DEPTH = 2e6;

export class ClickMarks {
	private readonly scene: Phaser.Scene;
	private mark?: { kind: MarkKind; at: Point; image: Phaser.GameObjects.Image; tween: Phaser.Tweens.Tween };

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
	}

	drop(kind: MarkKind, at: Point) {
		this.clear();
		const key = `overlay:mark-${kind}`;
		if (!this.scene.textures.exists(key)) return;
		const zoom = this.scene.cameras.main.zoom;
		const image = this.scene.add.image(at[0] * TILE, at[1] * TILE, key).setDepth(MARK_DEPTH);
		const scale = MARK_PX / zoom / image.width;
		image.setScale(scale * 1.25);

		const tween = this.scene.tweens.add({
			targets: image,
			scale: scale * 0.85,
			alpha: { from: 1, to: 0 },
			duration: FADE_MS,
			ease: "Cubic.easeIn",
			onComplete: () => this.clear(),
		});
		this.mark = { kind, at, image, tween };
	}

	views(): MarkView[] {
		const mark = this.mark;
		if (!mark?.image.active) return [];
		return [{ kind: mark.kind, x: mark.at[0], y: mark.at[1], alpha: mark.image.alpha }];
	}

	private clear() {
		const mark = this.mark;
		this.mark = undefined;
		if (!mark) return;
		if (mark.tween.isPlaying()) mark.tween.stop();
		mark.image.destroy();
	}
}
