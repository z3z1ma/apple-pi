import * as Phaser from "phaser";
import { OVERLAYS, PLACE_FILES, type Theme } from "../theme.js";
import type { WorldStore } from "../world-store.js";

/** Loads the theme's paintings, overlays, and character strips, then opens the world once the first snapshot is in. */
export class BootScene extends Phaser.Scene {
	private readonly theme: Theme;
	private readonly store: WorldStore;

	constructor(theme: Theme, store: WorldStore) {
		super("boot");
		this.theme = theme;
		this.store = store;
	}

	preload() {
		const { url, places, looks } = this.theme;
		for (const place of PLACE_FILES) this.load.image(`painting:${place}`, `${url}places/${places[place].painting}`);
		for (const overlay of OVERLAYS) this.load.image(`overlay:${overlay}`, `${url}overlays/${overlay}.png`);
		for (const [look, { frame }] of Object.entries(looks))
			this.load.spritesheet(`look:${look}`, `${url}characters/${look}.png`, {
				frameWidth: frame[0],
				frameHeight: frame[1],
			});
	}

	create() {
		// The world opens in the first headquarters, which the first snapshot names.
		if (this.store.get()) {
			this.scene.start("place");
			return;
		}
		const unsubscribe = this.store.subscribe(() => {
			unsubscribe();
			this.scene.start("place");
		});
	}
}
