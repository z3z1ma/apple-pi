import * as Phaser from "phaser";
import { fidgetArt, OVERLAYS, PLACE_FILES } from "../theme.js";
import { worn } from "../theme-store.js";
import type { WorldStore } from "../world-store.js";

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
		for (const overlay of OVERLAYS) this.load.image(`overlay:${overlay}`, `${url}overlays/${overlay}.png`);
		for (const overlay of fidgetArt(worn())) this.load.image(`overlay:${overlay}`, `${url}overlays/${overlay}.png`);
		for (const [look, { frame, idle }] of Object.entries(looks)) {
			this.load.spritesheet(`look:${look}`, `${url}characters/${look}.png`, {
				frameWidth: frame[0],
				frameHeight: frame[1],
			});
			if (idle)
				this.load.spritesheet(`look:${look}:idle`, `${url}characters/${look}-idle.png`, {
					frameWidth: idle.frame[0],
					frameHeight: idle.frame[1],
				});
		}
	}

	create() {
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
