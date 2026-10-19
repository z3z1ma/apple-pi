// The world UI: Phaser draws the places, React draws HTML over them. Both read the backend's snapshots through
// `window.agentWorld`, the preload API (a fixture in the headless tests).
import * as Phaser from "phaser";
import { createRoot } from "react-dom/client";
import type { AgentWorldApi } from "../src/world.js";
import { BootScene } from "./game/boot-scene.js";
import { PlaceScene } from "./game/place-scene.js";
import { Overlay } from "./overlay/overlay.js";
import { loadTheme, PLACES } from "./theme.js";
import { worldStore } from "./world-store.js";

declare global {
	interface Window {
		agentWorld: AgentWorldApi;
		/** Read-only view of what the world draws, for tests. */
		agentWorldView: { place(): string | undefined; characters(): string[] };
	}
}

// The game's menu replaces the browser's everywhere.
document.addEventListener("contextmenu", (event) => event.preventDefault());

const store = worldStore(window.agentWorld);
createRoot(document.getElementById("overlay")!).render(<Overlay store={store} />);

const theme = await loadTheme("fantasy");
const game = new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#140e18",
	scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
	scene: [new BootScene(theme), ...PLACES.map((place) => new PlaceScene(place, theme, store))],
});

const activePlace = () => game.scene.getScenes(true).find((scene) => scene instanceof PlaceScene);
window.agentWorldView = {
	place: () => activePlace()?.scene.key,
	characters: () => activePlace()?.characterNames() ?? [],
};
