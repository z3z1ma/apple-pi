// The world UI: Phaser draws the places, React draws HTML over them. Both read the backend's snapshots through
// `window.agentWorld`, the preload API (a fixture in the headless tests).
import * as Phaser from "phaser";
import { createRoot } from "react-dom/client";
import type { AgentWorldApi, ThemeChoice } from "../src/world.js";
import { conversations } from "./game/actions.js";
import { BootScene } from "./game/boot-scene.js";
import {
	type AvatarView,
	type BannerView,
	type DoorView,
	type FigureView,
	forgetSpots,
	type OverlayView,
	PlaceScene,
} from "./game/place-scene.js";
import { avatarLooks } from "./looks.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { publishMinimap } from "./overlay/interface/world-link.js";
import { Overlay } from "./overlay/overlay.js";
import { placePanels } from "./overlay/places/place-panels.js";
import { applyTheme, loadTheme, type Theme, ThemeProblem } from "./theme.js";
import { themeStore } from "./theme-store.js";
import { type ThemeOption, viewStore, type WorldIntent } from "./view-state.js";
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
			/** The frames the painting is drawn from: `__BASE` for a whole painting, one per strip for the gallery. */
			paintingFrames(): string[];
			/** Each texture's filtering now: true where its pixels are drawn crisp (nearest), false where smoothed. */
			filters(): Record<string, boolean>;
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

/** The last theme the world wore, kept in this window's storage: where a broken pack falls back to. */
const LAST_GOOD = "agent-world:last-good-theme";
const FIRST_THEME = "fantasy";

const firstSnapshot = new Promise<void>((resolve) => {
	if (store.get()) return resolve();
	const stop = store.subscribe(() => {
		stop();
		resolve();
	});
});

/** The installed packs as the backend checked them; a fixture backend without a list knows only the first theme. */
let installed: ThemeChoice[] = [];
async function readInstalled() {
	try {
		if (typeof window.agentWorld.themes === "function") installed = await window.agentWorld.themes();
	} catch {}
}

/** Why a pack cannot be worn, as `file: fault` lines; none when it can. */
const problemsOf = (choice: ThemeChoice | undefined) =>
	choice?.problems.map(({ file, fault }) => `${file}: ${fault}`) ?? [];

/** The pack `id`, checked by the backend and again here; a broken one throws `ThemeProblem`. */
async function check(id: string): Promise<Theme> {
	try {
		const problems = problemsOf(installed.find((choice) => choice.id === id));
		if (problems.length) throw new ThemeProblem(id, problems);
		return await loadTheme(id);
	} catch (error) {
		throw error instanceof ThemeProblem ? error : new ThemeProblem(id, [String(error)]);
	}
}

/**
 * Load the first pack of `wanted` that is good. A pack that is wanted first but broken is reported with its problems,
 * so the world can say why it wears another.
 */
async function firstGood(wanted: (string | null | undefined)[]): Promise<{ theme: Theme; failed?: ThemeProblem }> {
	const ids = [...new Set([...wanted, FIRST_THEME, ...installed.map((choice) => choice.id)])].filter(
		(id): id is string => !!id,
	);
	let failed: ThemeProblem | undefined;
	for (const id of ids) {
		try {
			return { theme: await check(id), failed };
		} catch (error) {
			failed ??= error as ThemeProblem;
		}
	}
	throw failed ?? new ThemeProblem(FIRST_THEME, ["No theme pack could be read."]);
}

/** The themes Settings offers: every installed pack (a broken one with why), or the one worn when none are listed. */
function offerThemes() {
	const worn = themeStore.get();
	const options: ThemeOption[] = installed.length
		? installed.map(({ id, name, description, problems }) => ({
				id,
				name,
				description,
				...(problems.length ? { broken: problemsOf({ id, name, description, problems })[0] } : {}),
			}))
		: worn
			? [{ id: worn.id, name: worn.name, description: null }]
			: [];
	view.update({ themes: options, theme: worn?.id });
}

/** Wear `theme` everywhere outside the scenes: tokens and skin, labels, avatar looks; and remember it as good. */
async function wear(theme: Theme) {
	themeStore.set(theme);
	await applyTheme(theme);
	view.update({ labels: theme.labels, avatarLooks: avatarLooks(theme) });
	offerThemes();
	try {
		localStorage.setItem(LAST_GOOD, theme.id);
	} catch {}
}

/** Say on screen, until dismissed, that the world wears `showing` because `failed` is broken. */
function report(failed: ThemeProblem | undefined, showing: Theme, switching = false) {
	if (!failed || failed.id === showing.id) return;
	view.update({ themeProblem: { theme: failed.id, showing: showing.name, problems: failed.problems, switching } });
}

await firstSnapshot;
await readInstalled();
const lastGood = (() => {
	try {
		return localStorage.getItem(LAST_GOOD);
	} catch {
		return null;
	}
})();
const opening = await firstGood([store.get()?.theme, lastGood]);
await wear(opening.theme);
report(opening.failed, opening.theme);
/** Themes found broken since the world opened: a snapshot naming one again does not try it again. */
const failedThemes = new Set(opening.failed ? [opening.failed.id] : []);

const place = new PlaceScene(store, view);
const boot = new BootScene(store);
const game = new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: opening.theme.world.backdrop,
	scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
	scene: [boot, place],
});

let switching = false;
let next: string | undefined;
/**
 * Switch the world to the theme `id`, live: check its pack first (a broken one leaves everything as it was and says
 * why), then fade the place out, drop every texture of the old pack, dress the page in the new one, and reopen the same
 * place in it. Characters, states, panels, and selections live outside the scenes and stay. Resolves true once worn.
 */
async function switchTheme(id: string): Promise<boolean> {
	if (id === themeStore.get()?.id) return true;
	if (switching) {
		next = id;
		return false;
	}
	switching = true;
	try {
		let theme: Theme;
		try {
			theme = await check(id);
		} catch (error) {
			failedThemes.add(id);
			report(error as ThemeProblem, themeStore.get()!, true);
			return false;
		}
		const scene = active();
		const ref = scene?.placeRef();
		await scene?.fadeAway();
		game.scene.stop("place");
		for (const key of game.textures.getTextureKeys()) if (!key.startsWith("__")) game.textures.remove(key);
		forgetSpots();
		failedThemes.delete(id);
		view.update({ themeProblem: undefined });
		await wear(theme);
		game.scene.start("boot", { next: ref ? { ref } : undefined });
		return true;
	} finally {
		switching = false;
		const queued = next;
		next = undefined;
		if (queued && queued !== themeStore.get()?.id) void switchTheme(queued);
	}
}

// The theme chosen elsewhere (another window, the preference changed) is worn here too.
store.subscribe(() => {
	const id = store.get()?.theme;
	if (id && id !== themeStore.get()?.id && !failedThemes.has(id)) void switchTheme(id);
});
/** Settings: a theme is kept only once the world wears it, so a broken pack is never remembered as the choice. */
async function chooseTheme(id: string) {
	await readInstalled();
	offerThemes();
	if (await switchTheme(id)) await store.setTheme(id);
}

const talkedTo: string[] = [];
// Talking to a character, from the world or the side panel, opens its conversation panel.
conversationPanel.connect(window.agentWorld);
placePanels.connect(window.agentWorld, view);
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
	paintingFrames: () => active()?.paintingFrames() ?? [],
	filters: () => active()?.filterView() ?? {},
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
publishMinimap(view, store, active);
const intents: WorldIntent[] = [];
window.agentWorldInterface = { intents: () => [...intents] };
view.onIntent((intent) => {
	intents.push(intent);
	const scene = active();
	const character = "character" in intent ? store.get()?.characters.find((c) => c.id === intent.character) : undefined;
	// The scene handles walk-to, go-to, and walk-grid itself.
	if (intent.kind === "travel") scene?.travel(intent.place);
	if (intent.kind === "choose-theme") void chooseTheme(intent.theme);
	// Talk to from the side panel: the conversation opens without walking.
	if (intent.kind === "talk-to" && character) conversations.open(character);
});
