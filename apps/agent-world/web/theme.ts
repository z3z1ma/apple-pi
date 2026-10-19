// A theme pack as the world UI reads it: its manifest (labels, lines, style tokens, skin, and the canvas's colours),
// a painting and a hand-authored data file per place, overlays, and character looks. Packs live in
// apps/agent-world/themes/<theme>/, served beside the built UI; their format and check are in src/theme-pack.ts.
// Before the world switches to a pack it checks it (all but the sheets' pixels), so a broken pack never half-loads.
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
	/** Its name in Settings. */
	name: string;
	/** Where its files are, relative to the page (`themes/<id>/`). */
	url: string;
	places: Record<string, PlaceData>;
	looks: Record<string, Look>;
	/** What each kind of place and each role is called in this theme. */
	labels: Record<string, string>;
	/** The theme's own lines (`TEXT_KEYS`). */
	text: Record<string, string>;
	/** CSS custom properties put on the page's root, with pack files resolved against `url`. */
	style: Record<string, string>;
	/** The skin's stylesheet URL. */
	skin: string;
	world: WorldStyle;
	/** How it names and dresses each kind of fidget object its places hold. */
	fidgets: Partial<Record<FidgetKind, FidgetStyle>>;
	/** Its ambient characters (ticket 08), by cast name; their places say where each stands. */
	ambient?: Record<string, AmbientMember>;
}

export type TextKey = (typeof TEXT_KEYS)[number];

/** One of the theme's lines, with its placeholders filled. */
export function say(theme: Theme | undefined, key: TextKey, values?: Record<string, string | number>): string {
	return fill(theme?.text[key] ?? "", values);
}

/** Overlay sprites the world places over paintings, loaded when the pack has them. */
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
	// The click markers (the cursor's sprites are read as images by `overlay/pointer/cursor.ts`).
	"mark-walk",
	"mark-act",
] as const;

/** The fidget objects' sprites a pack's places use (only kinds it places: the rest are optional and may be absent). */
export function fidgetArt(theme: Pick<Theme, "places">): string[] {
	const art = new Set<string>();
	for (const place of Object.values(theme.places))
		for (const slot of place.overlaySlots)
			if (slot.kind === "fidget" && slot.fidget)
				for (const name of slot.fidget === "pet" ? petArt(slot.look) : FIDGETS[slot.fidget].art) art.add(name);
	return [...art];
}

/** A pack the world would not switch to, with why: each problem as `file: fault`. */
export class ThemeProblem extends Error {
	readonly id: string;
	readonly problems: string[];
	constructor(id: string, problems: string[]) {
		super(`The ${id} theme is broken: ${problems[0] ?? "it could not be read"}`);
		this.id = id;
		this.problems = problems;
	}
}

/** Reads a pack over HTTP the way the world loads it; images by their header alone. */
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

/**
 * Resolve `url(...)` references to the pack's own files to absolute URLs: a token is read inside the skin's stylesheet,
 * which would otherwise resolve them against its own folder.
 */
function resolveUrls(css: string, url: string): string {
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote: string, ref: string) =>
		/^(data:|https?:|#|\/)/i.test(ref) ? whole : `url(${quote}${new URL(url + ref, document.baseURI).href}${quote})`,
	);
}

/** Load and check the pack `id`; a broken one throws `ThemeProblem` naming each file and fault. */
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

/**
 * Dress the page in the theme: its style tokens on the root element and its skin's stylesheet, which replaces the last
 * theme's once it has loaded (so nothing shows unstyled in between). Resolves once the skin is in.
 */
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
