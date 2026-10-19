import * as Phaser from "phaser";
import { fidgetArt, OVERLAYS, PLACE_FILES } from "../theme.js";
import { worn } from "../theme-store.js";
import type { WorldStore } from "../world-store.js";

/**
 * Loads the theme's paintings, overlays, and character strips, then opens the world once the first snapshot is in.
 * Switching theme runs it again with the place to reopen.
 */
export class BootScene extends Phaser.Scene {
	private readonly store: WorldStore;
	private next?: object;

	constructor(store: WorldStore) {
		super("boot");
		this.store = store;
	}

	init(data?: { next?: object }) {
		this.next = data?.next;
	}

	preload() {
		const { url, places, looks } = worn();
		for (const place of PLACE_FILES) this.load.image(`painting:${place}`, `${url}places/${places[place].painting}`);
		// Ambient overlays are optional: a pack without fire or water simply has none.
		for (const overlay of OVERLAYS) this.load.image(`overlay:${overlay}`, `${url}overlays/${overlay}.png`);
		// Fidget objects too, for the kinds its places hold.
		for (const overlay of fidgetArt(worn())) this.load.image(`overlay:${overlay}`, `${url}overlays/${overlay}.png`);
		for (const [look, { frame }] of Object.entries(looks))
			this.load.spritesheet(`look:${look}`, `${url}characters/${look}.png`, {
				frameWidth: frame[0],
				frameHeight: frame[1],
			});
	}

	create() {
		// The world opens in the first headquarters, which the first snapshot names.
		if (this.store.get()) {
			this.scene.start("place", this.next);
			return;
		}
		const unsubscribe = this.store.subscribe(() => {
			unsubscribe();
			this.scene.start("place", this.next);
		});
	}
}
