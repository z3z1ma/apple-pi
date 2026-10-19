// The world UI: Phaser draws the places, React draws HTML over them. Both read the backend's snapshots through
// `window.agentWorld`, the preload API (a fixture in the headless tests).
import * as Phaser from "phaser";
import { createRoot } from "react-dom/client";
import type { AgentWorldApi } from "../src/world.js";
import { conversations } from "./game/actions.js";
import { BootScene } from "./game/boot-scene.js";
import {
	type AvatarView,
	type BannerView,
	type DoorView,
	type FigureView,
	type OverlayView,
	PlaceScene,
} from "./game/place-scene.js";
import { avatarLooks } from "./looks.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { publishMinimap } from "./overlay/interface/world-link.js";
import { Overlay } from "./overlay/overlay.js";
import { placePanels } from "./overlay/places/place-panels.js";
import { loadTheme } from "./theme.js";
import { viewStore, type WorldIntent } from "./view-state.js";
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
			/** Characters walking out because their session stopped or moved elsewhere. */
			departing(): FigureView[];
			/** The animated overlays in the place's slots: fire, water, and glows. */
			overlays(): OverlayView[];
			/** The banners hung in the place and the names stitched on them. */
			banners(): BannerView[];
			doors(): DoorView[];
			gallery():
				| { niches: number; wings: { name: string; boarded: boolean; door: "open" | "closed" | "boarded" }[] }
				| undefined;
			walkGrid(): boolean;
			lookAt(door: string): boolean;
			/** Messenger birds in flight with mail: which letter, from whom to whom, where, and its wing frame. */
			birds(): { id: string; from: string; to: string; x: number; y: number; frame: number; out: boolean }[];
			/** The place's host (the innkeeper), where it stands. */
			host(): { name: string; look: string; x: number; y: number } | undefined;
			/** The operator's avatar: where it is, its facing and frame, and the rest of its walk. */
			avatar(): AvatarView | undefined;
			/** A point in tiles, on screen in CSS px. */
			toScreen(x: number, y: number): [number, number] | undefined;
			zoom(): { zoom: number; target: number; min: number; max: number } | undefined;
			/** Ids of the characters talked to, in order (the conversation panel will open for them). */
			talkedTo(): string[];
		};
		/** What the interface asked of the world, in order, for tests. */
		agentWorldInterface: { intents(): WorldIntent[] };
	}
}

// The game's menu replaces the browser's everywhere.
window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

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

const talkedTo: string[] = [];
// Talking to a character, from the world or the side panel, opens its conversation panel.
conversationPanel.connect(window.agentWorld, theme);
placePanels.connect(window.agentWorld, theme, view);
conversations.subscribe((character) => {
	talkedTo.push(character.id);
	conversationPanel.open(character);
});

const active = () => (game.scene.isActive("place") ? place : undefined);
window.agentWorldView = {
	place: () => active()?.placeKey(),
	painting: () => active()?.painting(),
	characters: () => active()?.characterNames() ?? [],
	figures: () => active()?.figureViews() ?? [],
	departing: () => active()?.departingViews() ?? [],
	overlays: () => active()?.overlayViews() ?? [],
	banners: () => active()?.bannerViews() ?? [],
	doors: () => active()?.doorViews() ?? [],
	gallery: () => active()?.galleryView(),
	walkGrid: () => active()?.walkGridShown() ?? false,
	lookAt: (door) => active()?.lookAt(door) ?? false,
	host: () => active()?.hostView(),
	birds: () => active()?.birdViews() ?? [],
	avatar: () => active()?.avatarView(),
	toScreen: (x, y) => active()?.toScreen([x, y]),
	zoom: () => active()?.zoomView(),
	talkedTo: () => [...talkedTo],
};

// The interface: the minimap follows the scene, and the interface's intents reach the world.
view.update({ labels: theme.labels, avatarLooks: avatarLooks(theme) });
publishMinimap(view, store, theme, active);
const intents: WorldIntent[] = [];
window.agentWorldInterface = { intents: () => [...intents] };
view.onIntent((intent) => {
	intents.push(intent);
	const scene = active();
	const character = "character" in intent ? store.get()?.characters.find((c) => c.id === intent.character) : undefined;
	// The scene handles walk-to, go-to, and walk-grid itself.
	if (intent.kind === "travel") scene?.travel(intent.place);
	// Talk to from the side panel: the conversation opens without walking.
	if (intent.kind === "talk-to" && character) conversations.open(character);
});
