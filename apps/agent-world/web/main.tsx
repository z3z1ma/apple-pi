// The world UI: Phaser draws the places, React draws HTML over them. Both read the backend's snapshots through
// `window.agentWorld`, the preload API (a fixture in the headless tests).
import * as Phaser from "phaser";
import { createRoot } from "react-dom/client";
import type { AgentWorldApi } from "../src/world.js";
import { BootScene } from "./game/boot-scene.js";
import { type DoorView, type FigureView, PlaceScene } from "./game/place-scene.js";
import { Overlay } from "./overlay/overlay.js";
import { loadTheme } from "./theme.js";
import { viewStore } from "./view-state.js";
import { worldStore } from "./world-store.js";

declare global {
	interface Window {
		agentWorld: AgentWorldApi;
		/** Read-only view of what the world draws, for tests (and `lookAt`, which only moves the view). */
		agentWorldView: {
			place(): string | undefined;
			painting(): string | undefined;
			characters(): string[];
			figures(): FigureView[];
			doors(): DoorView[];
			gallery(): { niches: number; wings: { name: string; boarded: boolean }[] } | undefined;
			walkGrid(): boolean;
			lookAt(door: string): boolean;
		};
	}
}

// The game's menu replaces the browser's everywhere.
document.addEventListener("contextmenu", (event) => event.preventDefault());

const store = worldStore(window.agentWorld);
const view = viewStore();
createRoot(document.getElementById("overlay")!).render(<Overlay store={store} view={view} />);

const theme = await loadTheme("fantasy");
const place = new PlaceScene(theme, store, view);
const game = new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#140e18",
	scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
	scene: [new BootScene(theme, store), place],
});

const active = () => (game.scene.isActive("place") ? place : undefined);
window.agentWorldView = {
	place: () => active()?.placeKey(),
	painting: () => active()?.painting(),
	characters: () => active()?.characterNames() ?? [],
	figures: () => active()?.figureViews() ?? [],
	doors: () => active()?.doorViews() ?? [],
	gallery: () => active()?.galleryView(),
	walkGrid: () => active()?.walkGridShown() ?? false,
	lookAt: (door) => active()?.lookAt(door) ?? false,
};
