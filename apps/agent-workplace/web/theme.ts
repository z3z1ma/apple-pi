import {
	type AmbientMember,
	checkPack,
	describeProblems,
	FIDGETS,
	type FidgetKind,
	type FidgetStyle,
	fill,
	type Look,
	type PackProblem,
	type PackReader,
	PLACE_FILES,
	type PlaceData,
	petArt,
	pngSize,
	type TEXT_KEYS,
	type ThemeManifest,
	type WorldStyle,
} from "../src/theme-pack.js";

export {
	type Atmosphere,
	type Door,
	FIDGETS,
	type FidgetKind,
	type FidgetParticle,
	type FidgetStyle,
	type Look,
	type OverlaySlot,
	PET_FRAME_ORDER,
	type PetFrame,
	PLACE_FILES,
	type PlaceData,
	type Point,
	petArt,
	type Rect,
	slotStyle,
	TILE,
	type WorldStyle,
} from "../src/theme-pack.js";

export interface Theme {
	id: string;

	name: string;

	url: string;
	places: Record<string, PlaceData>;
	looks: Record<string, Look>;

	labels: Record<string, string>;

	text: Record<string, string>;

	style: Record<string, string>;

	skin: string;
	world: WorldStyle;

	fidgets: Partial<Record<FidgetKind, FidgetStyle>>;

	ambient?: Record<string, AmbientMember>;
}

export type TextKey = (typeof TEXT_KEYS)[number];

export function say(theme: Theme | undefined, key: TextKey, values?: Record<string, string | number>): string {
	return fill(theme?.text[key] ?? "", values);
}

export const OVERLAYS = [
	"door-open",
	"door-closed",
	"door-boarded",
	"banner-cream",
	"fire-0",
	"fire-1",
	"fire-2",
	"fire-3",
	"water-0",
	"water-1",
	"water-2",
	"water-3",
	"bed",
	"bird-0",
	"bird-1",
	"bird-2",
	"bird-3",
	"letters",
	"blade-passing",
	"blade-failing",
	"blade-running",
	"notice-open",
	"notice-urgent",
	"notice-progress",
	"notice-done",

	"mark-walk",
	"mark-act",
] as const;

export function fidgetArt(theme: Pick<Theme, "places">): string[] {
	const art = new Set<string>();
	for (const place of Object.values(theme.places))
		for (const slot of place.overlaySlots)
			if (slot.kind === "fidget" && slot.fidget)
				for (const name of slot.fidget === "pet" ? petArt(slot.look) : FIDGETS[slot.fidget].art) art.add(name);
	return [...art];
}

export class ThemeProblem extends Error {
	readonly id: string;
	readonly problems: string[];
	constructor(id: string, problems: string[]) {
		super(`The ${id} theme is broken: ${problems[0] ?? "it could not be read"}`);
		this.id = id;
		this.problems = problems;
	}
}

function webReader(url: string): PackReader {
	const bytes = async (path: string) => {
		try {
			const response = await fetch(url + path);
			return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
		} catch {
			return undefined;
		}
	};
	return {
		async text(path) {
			const data = await bytes(path);
			return data && new TextDecoder().decode(data);
		},
		async image(path) {
			const data = await bytes(path);
			return data && pngSize(data);
		},
	};
}

function resolveUrls(css: string, url: string): string {
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote: string, ref: string) =>
		/^(data:|https?:|#|\/)/i.test(ref) ? whole : `url(${quote}${new URL(url + ref, document.baseURI).href}${quote})`,
	);
}

export async function loadTheme(id: string): Promise<Theme> {
	const url = `themes/${id}/`;
	const reader = webReader(url);
	let problems: PackProblem[];
	try {
		problems = await checkPack(reader, id, { pixels: false });
	} catch (error) {
		throw new ThemeProblem(id, [String(error)]);
	}
	if (problems.length) throw new ThemeProblem(id, describeProblems(problems));
	const json = async <T>(path: string): Promise<T> => JSON.parse((await reader.text(path)) ?? "null") as T;
	const manifest = await json<ThemeManifest>("theme.json");
	const places: Record<string, PlaceData> = {};
	await Promise.all(
		PLACE_FILES.map(async (place) => {
			places[place] = await json<PlaceData>(`places/${place}.json`);
		}),
	);
	return {
		id,
		name: manifest.name,
		url,
		places,
		looks: await json<Record<string, Look>>("characters/looks.json"),
		labels: manifest.labels,
		text: manifest.text,
		style: Object.fromEntries(Object.entries(manifest.style).map(([token, css]) => [token, resolveUrls(css, url)])),
		skin: url + manifest.skin,
		world: manifest.world,
		fidgets: manifest.fidgets ?? {},
		ambient: manifest.ambient ?? {},
	};
}

const SKIN_LINK = "aw-theme-skin";
let applied: string[] = [];

export function applyTheme(theme: Theme): Promise<void> {
	const root = document.documentElement;
	for (const token of applied) root.style.removeProperty(token);
	for (const [token, css] of Object.entries(theme.style)) root.style.setProperty(token, css);
	applied = Object.keys(theme.style);
	root.dataset.theme = theme.id;
	const old = document.querySelectorAll<HTMLLinkElement>(`link.${SKIN_LINK}`);
	if ([...old].some((link) => link.getAttribute("href") === theme.skin)) return Promise.resolve();
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.className = SKIN_LINK;
	link.href = theme.skin;
	return new Promise((resolve) => {
		const done = () => {
			for (const previous of old) previous.remove();
			resolve();
		};
		link.addEventListener("load", done, { once: true });
		link.addEventListener("error", done, { once: true });
		document.head.append(link);
	});
}
