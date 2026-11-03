import * as Phaser from "phaser";
import { createRoot } from "react-dom/client";
import type { AgentWorkplaceApi, ThemeChoice } from "../src/world.js";
import { conversations } from "./game/actions.js";
import type { AmbientView } from "./game/ambient.js";
import { BootScene } from "./game/boot-scene.js";
import type { FidgetView } from "./game/fidgets.js";
import {
	type AvatarView,
	type BannerView,
	type DoorView,
	type FigureView,
	forgetSpots,
	type OverlayView,
	PlaceScene,
} from "./game/place-scene.js";
import type { WorkView } from "./game/places/forge.js";
import type { NoticeView } from "./game/places/quest-office.js";
import type { SignView, TownsfolkView } from "./game/places/square.js";
import { avatarLooks } from "./looks.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { chatLines } from "./overlay/interface/chat-lines.js";
import { publishMinimap } from "./overlay/interface/world-link.js";
import { Overlay } from "./overlay/overlay.js";
import { atlassian } from "./overlay/places/atlassian-state.js";
import { forge } from "./overlay/places/forge-state.js";
import { notepad } from "./overlay/places/notepad-state.js";
import { placePanels } from "./overlay/places/place-panels.js";
import { recruiting } from "./overlay/places/recruit-state.js";
import { renaming } from "./overlay/places/rename-state.js";
import { retiring } from "./overlay/places/retire-state.js";
import { slack } from "./overlay/places/slack-state.js";
import { workplacePanels } from "./overlay/places/workplace-state.js";
import { applyTheme, loadTheme, type Theme, ThemeProblem } from "./theme.js";
import { themeStore } from "./theme-store.js";
import { type ThemeOption, viewStore, type WorldIntent } from "./view-state.js";
import { worldStore } from "./world-store.js";

declare global {
	interface Window {
		agentWorkplace: AgentWorkplaceApi;

		agentWorldView: {
			place(): string | undefined;
			painting(): string | undefined;
			characters(): string[];
			figures(): FigureView[];

			departing(): FigureView[];

			overlays(): OverlayView[];

			paintingFrames(): string[];

			filters(): Record<string, boolean>;

			banners(): BannerView[];
			doors(): DoorView[];
			gallery():
				| { niches: number; wings: { name: string; boarded: boolean; door: "open" | "closed" | "boarded" }[] }
				| undefined;
			walkGrid(): boolean;
			lookAt(door: string): boolean;

			birds(): { id: string; from: string; to: string; x: number; y: number; frame: number; out: boolean }[];

			townsfolk(): TownsfolkView[];

			signs(): SignView[];

			work(): WorkView[];

			notices(): NoticeView[];

			fidgets(): FidgetView[];

			pointer(): ReturnType<PlaceScene["pointerView"]> | undefined;

			host(): { name: string; look: string; x: number; y: number } | undefined;

			recruiter(): { name: string; look: string; x: number; y: number } | undefined;

			ambient(): AmbientView[];

			atmosphere(): ReturnType<PlaceScene["atmosphereView"]>;

			avatar(): AvatarView | undefined;

			toScreen(x: number, y: number): [number, number] | undefined;
			zoom(): { zoom: number; target: number; min: number; max: number } | undefined;

			talkedTo(): string[];
		};

		agentWorldInterface: { intents(): WorldIntent[] };
	}
}

window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

const store = worldStore(window.agentWorkplace);
const view = viewStore();
createRoot(document.getElementById("overlay")!).render(<Overlay store={store} view={view} />);

const LAST_GOOD = "agent-world:last-good-theme";
const FIRST_THEME = "fantasy";

const firstSnapshot = new Promise<void>((resolve) => {
	if (store.get()) return resolve();
	const stop = store.subscribe(() => {
		stop();
		resolve();
	});
});

let installed: ThemeChoice[] = [];
async function readInstalled() {
	try {
		if (typeof window.agentWorkplace.themes === "function") installed = await window.agentWorkplace.themes();
	} catch {}
}

const problemsOf = (choice: ThemeChoice | undefined) =>
	choice?.problems.map(({ file, fault }) => `${file}: ${fault}`) ?? [];

async function check(id: string): Promise<Theme> {
	try {
		const problems = problemsOf(installed.find((choice) => choice.id === id));
		if (problems.length) throw new ThemeProblem(id, problems);
		return await loadTheme(id);
	} catch (error) {
		throw error instanceof ThemeProblem ? error : new ThemeProblem(id, [String(error)]);
	}
}

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

async function wear(theme: Theme) {
	themeStore.set(theme);
	await applyTheme(theme);
	view.update({ labels: theme.labels, avatarLooks: avatarLooks(theme) });
	offerThemes();
	try {
		localStorage.setItem(LAST_GOOD, theme.id);
	} catch {}
}

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

store.subscribe(() => {
	const id = store.get()?.theme;
	if (id && id !== themeStore.get()?.id && !failedThemes.has(id)) void switchTheme(id);
});

async function chooseTheme(id: string) {
	await readInstalled();
	offerThemes();
	if (await switchTheme(id)) await store.setTheme(id);
}

const talkedTo: string[] = [];

conversationPanel.connect(window.agentWorkplace);
placePanels.connect(window.agentWorkplace, view);
recruiting.connect(window.agentWorkplace, view);
renaming.connect(window.agentWorkplace, view);
retiring.connect(window.agentWorkplace, view);
notepad.connect(window.agentWorkplace);
workplacePanels.connect(window.agentWorkplace, view);
slack.connect(window.agentWorkplace);
forge.connect(window.agentWorkplace);
atlassian.connect(window.agentWorkplace, view);
void atlassian.refreshStatus();

chatLines.connect(window.agentWorkplace);
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
	recruiter: () => active()?.recruiterView(),
	ambient: () => active()?.ambientViews() ?? [],
	atmosphere: () => active()?.atmosphereView(),
	townsfolk: () => active()?.townsfolkViews() ?? [],
	signs: () => active()?.signViews() ?? [],
	work: () => active()?.workViews() ?? [],
	notices: () => active()?.noticeViews() ?? [],
	fidgets: () => active()?.fidgetViews() ?? [],
	pointer: () => active()?.pointerView(),
	birds: () => active()?.birdViews() ?? [],
	avatar: () => active()?.avatarView(),
	toScreen: (x, y) => active()?.toScreen([x, y]),
	zoom: () => active()?.zoomView(),
	talkedTo: () => [...talkedTo],
};

publishMinimap(view, store, active);
const intents: WorldIntent[] = [];
window.agentWorldInterface = { intents: () => [...intents] };
view.onIntent((intent) => {
	intents.push(intent);
	const scene = active();
	const character = "character" in intent ? store.get()?.characters.find((c) => c.id === intent.character) : undefined;

	if (intent.kind === "travel") scene?.travel(intent.place);
	if (intent.kind === "choose-theme") void chooseTheme(intent.theme);

	if (intent.kind === "talk-to" && character) conversations.open(character);
});
