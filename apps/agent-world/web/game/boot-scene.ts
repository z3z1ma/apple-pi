import * as Phaser from "phaser";
import { PLACES, type Theme } from "../theme.js";

/** Loads the theme's paintings and character sheets, then opens the headquarters. */
export class BootScene extends Phaser.Scene {
	private readonly theme: Theme;

	constructor(theme: Theme) {
		super("boot");
		this.theme = theme;
	}

	preload() {
		const { url, places, looks } = this.theme;
		for (const place of PLACES) this.load.image(`painting:${place}`, `${url}places/${places[place].painting}`);
		for (const [look, { frame }] of Object.entries(looks))
			this.load.spritesheet(`look:${look}`, `${url}characters/${look}.png`, {
				frameWidth: frame[0],
				frameHeight: frame[1],
			});
	}

	create() {
		this.scene.start("headquarters");
	}
}
