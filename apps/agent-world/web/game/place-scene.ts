import * as Phaser from "phaser";
import type { Character } from "../../src/world.js";
import { type PlaceData, type Theme, TILE } from "../theme.js";
import type { WorldStore } from "../world-store.js";

const PERSON_TILES = 1.8; // a standing character is drawn this many tiles tall
const STANDING = 120; // sprite px from head to feet in a standing frame
const STAND_FRAME = 14;

interface Figure {
	character: Character;
	sprite: Phaser.GameObjects.Sprite;
	shadow: Phaser.GameObjects.Ellipse;
}

function hash(text: string): number {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) >>> 0;
	return h;
}

/** One place: its painting, with the characters who are there standing at its spots. */
export class PlaceScene extends Phaser.Scene {
	private readonly theme: Theme;
	private readonly store: WorldStore;
	private place!: PlaceData;
	private figures = new Map<string, Figure>();

	constructor(key: string, theme: Theme, store: WorldStore) {
		super(key);
		this.theme = theme;
		this.store = store;
	}

	create() {
		this.figures = new Map();
		this.place = this.theme.places[this.scene.key];
		const { cols, rows } = this.place;
		this.add
			.image(0, 0, `painting:${this.scene.key}`)
			.setOrigin(0)
			.setDisplaySize(cols * TILE, rows * TILE);
		this.fitCamera();
		this.scale.on("resize", this.fitCamera, this);
		const unsubscribe = this.store.subscribe(() => this.showCharacters());
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			unsubscribe();
			this.scale.off("resize", this.fitCamera, this);
		});
		this.showCharacters();
	}

	/** The names of the characters drawn here, in order: a read-only hook for tests. */
	characterNames(): string[] {
		return [...this.figures.values()].map((figure) => figure.character.name);
	}

	/** Fill the window with the place, centred. */
	private fitCamera() {
		const width = this.place.cols * TILE;
		const height = this.place.rows * TILE;
		const camera = this.cameras.main;
		camera.setZoom(Math.max(this.scale.width / width, this.scale.height / height));
		camera.centerOn(width / 2, height / 2);
	}

	private showCharacters() {
		const characters = this.store.get()?.characters ?? [];
		const ids = new Set(characters.map((character) => character.id));
		for (const [id, figure] of this.figures)
			if (!ids.has(id)) {
				figure.sprite.destroy();
				figure.shadow.destroy();
				this.figures.delete(id);
			}
		const spots = this.place.spots;
		characters.forEach((character, index) => {
			// More characters than spots stand a little aside of the taken ones until placement rules arrive.
			const [x, y] = spots[index % spots.length];
			const at = { x: (x + Math.floor(index / spots.length) * 0.5) * TILE, y: y * TILE };
			const figure = this.figures.get(character.id) ?? this.addFigure(character);
			figure.character = character;
			figure.sprite.setPosition(at.x, at.y).setDepth(at.y);
			figure.shadow.setPosition(at.x, at.y - 2).setDepth(at.y - 1);
		});
		// Keep the drawn order the snapshot's order.
		this.figures = new Map(characters.map((character) => [character.id, this.figures.get(character.id)!]));
	}

	private addFigure(character: Character): Figure {
		const looks = Object.keys(this.theme.looks).sort();
		const look = looks[hash(character.id) % looks.length];
		const shadow = this.add.ellipse(0, 0, TILE * 0.62, TILE * 0.2, 0x000000, 0.28);
		const sprite = this.add
			.sprite(0, 0, `look:${look}`, STAND_FRAME)
			.setOrigin(0.5, 1)
			.setScale((PERSON_TILES * TILE) / STANDING);
		const figure = { character, sprite, shadow };
		this.figures.set(character.id, figure);
		return figure;
	}
}
