// Workplace themes: the palettes of well-known editor and app themes, each with a light and a dark variant. A theme
// gives a few base colors; the rest of Workplace's palette (hover, selection, tints, text on fills) is derived from
// them, so every surface follows a theme through the same `--wp-*` variables. "Workplace" is the palette written in
// workplace.css itself and sets no variables.

/** The colors a theme variant chooses; everything else is derived. */
export interface Palette {
	/** Messages and content. */
	bg: string;
	/** Headers, cards and the composer. */
	panel: string;
	/** The conversation list beside the rail. */
	sidebar: string;
	text: string;
	muted: string;
	border: string;
	/** Selection, focus and the primary control. */
	accent: string;
	link: string;
	/** The send and create buttons, and "done". */
	green: string;
	danger: string;
	warning: string;
	/** The app rail and title bar; always dark, as in Slack. */
	rail: string;
	/** Inline code. */
	code: string;
}

export interface Theme {
	id: string;
	name: string;
	/** What it is, for the picker. */
	note: string;
	light: Palette;
	dark: Palette;
}

export const THEMES: Theme[] = [
	{
		id: "workplace",
		name: "Workplace",
		note: "Aubergine, the house palette",
		light: {
			bg: "#ffffff",
			panel: "#f8f7fa",
			sidebar: "#f4f0f7",
			text: "#2a2530",
			muted: "#746c7e",
			border: "#e5e0e9",
			accent: "#77548f",
			link: "#4e63a8",
			green: "#18765a",
			danger: "#ad4e61",
			warning: "#9a4300",
			rail: "#291831",
			code: "#a34870",
		},
		dark: {
			bg: "#1b1d21",
			panel: "#222529",
			sidebar: "#241b2d",
			text: "#e9e5ed",
			muted: "#b0a7bb",
			border: "#3b3842",
			accent: "#c5a4df",
			link: "#a7b8f4",
			green: "#247e62",
			danger: "#ed99a8",
			warning: "#d8b378",
			rail: "#18151d",
			code: "#e9a2be",
		},
	},
	{
		id: "slacker",
		name: "Slacker",
		note: "A certain aubergine chat app, slightly off-brand",
		light: {
			bg: "#ffffff",
			panel: "#f8f8f8",
			sidebar: "#f4ede4",
			text: "#1d1c1d",
			muted: "#616061",
			border: "#dddddd",
			accent: "#1264a3",
			link: "#1264a3",
			green: "#007a5a",
			danger: "#e01e5a",
			warning: "#b06600",
			rail: "#3f0e40",
			code: "#c01343",
		},
		dark: {
			bg: "#1a1d21",
			panel: "#222529",
			sidebar: "#19171d",
			text: "#d1d2d3",
			muted: "#ababad",
			border: "#35373b",
			accent: "#1d9bd1",
			link: "#1d9bd1",
			green: "#007a5a",
			danger: "#e8912d",
			warning: "#ecb22e",
			rail: "#19171d",
			code: "#e8912d",
		},
	},
	{
		id: "one",
		name: "Atom One",
		note: "Atom's One Light and One Dark",
		light: {
			bg: "#fafafa",
			panel: "#f0f0f1",
			sidebar: "#eaeaeb",
			text: "#383a42",
			muted: "#696c77",
			border: "#dbdbdc",
			accent: "#4078f2",
			link: "#4078f2",
			green: "#50a14f",
			danger: "#e45649",
			warning: "#c18401",
			rail: "#282c34",
			code: "#a626a4",
		},
		dark: {
			bg: "#282c34",
			panel: "#21252b",
			sidebar: "#21252b",
			text: "#abb2bf",
			muted: "#7f848e",
			border: "#3e4451",
			accent: "#61afef",
			link: "#61afef",
			green: "#98c379",
			danger: "#e06c75",
			warning: "#e5c07b",
			rail: "#181a1f",
			code: "#c678dd",
		},
	},
	{
		id: "catppuccin",
		name: "Catppuccin",
		note: "Latte and Mocha",
		light: {
			bg: "#eff1f5",
			panel: "#e6e9ef",
			sidebar: "#dce0e8",
			text: "#4c4f69",
			muted: "#6c6f85",
			border: "#ccd0da",
			accent: "#8839ef",
			link: "#1e66f5",
			green: "#40a02b",
			danger: "#d20f39",
			warning: "#df8e1d",
			rail: "#4c4f69",
			code: "#ea76cb",
		},
		dark: {
			bg: "#1e1e2e",
			panel: "#181825",
			sidebar: "#181825",
			text: "#cdd6f4",
			muted: "#a6adc8",
			border: "#313244",
			accent: "#cba6f7",
			link: "#89b4fa",
			green: "#a6e3a1",
			danger: "#f38ba8",
			warning: "#f9e2af",
			rail: "#11111b",
			code: "#f5c2e7",
		},
	},
	{
		id: "gruvbox",
		name: "Gruvbox",
		note: "Retro groove, light and dark",
		light: {
			bg: "#fbf1c7",
			panel: "#f2e5bc",
			sidebar: "#ebdbb2",
			text: "#3c3836",
			muted: "#7c6f64",
			border: "#d5c4a1",
			accent: "#af3a03",
			link: "#076678",
			green: "#79740e",
			danger: "#9d0006",
			warning: "#b57614",
			rail: "#3c3836",
			code: "#8f3f71",
		},
		dark: {
			bg: "#282828",
			panel: "#32302f",
			sidebar: "#1d2021",
			text: "#ebdbb2",
			muted: "#a89984",
			border: "#504945",
			accent: "#fe8019",
			link: "#83a598",
			green: "#b8bb26",
			danger: "#fb4934",
			warning: "#fabd2f",
			rail: "#1d2021",
			code: "#d3869b",
		},
	},
	{
		id: "dracula",
		name: "Dracula",
		note: "Dracula, and Alucard by day",
		light: {
			bg: "#fffbeb",
			panel: "#f5f0dc",
			sidebar: "#efe9d0",
			text: "#1f1f1f",
			muted: "#6c664b",
			border: "#ded8c0",
			accent: "#644ac9",
			link: "#036a96",
			green: "#14710a",
			danger: "#cb3a2a",
			warning: "#846e15",
			rail: "#282a36",
			code: "#a3144d",
		},
		dark: {
			bg: "#282a36",
			panel: "#21222c",
			sidebar: "#21222c",
			text: "#f8f8f2",
			muted: "#a3acd0",
			border: "#44475a",
			accent: "#bd93f9",
			link: "#8be9fd",
			green: "#50fa7b",
			danger: "#ff5555",
			warning: "#f1fa8c",
			rail: "#191a21",
			code: "#ff79c6",
		},
	},
	{
		id: "nord",
		name: "Nord",
		note: "Arctic, north-bluish",
		light: {
			bg: "#eceff4",
			panel: "#e5e9f0",
			sidebar: "#d8dee9",
			text: "#2e3440",
			muted: "#4c566a",
			border: "#d1d7e2",
			accent: "#5e81ac",
			link: "#5e81ac",
			green: "#5a7a46",
			danger: "#bf616a",
			warning: "#a0742a",
			rail: "#2e3440",
			code: "#b48ead",
		},
		dark: {
			bg: "#2e3440",
			panel: "#3b4252",
			sidebar: "#272c36",
			text: "#eceff4",
			muted: "#a7b1c2",
			border: "#434c5e",
			accent: "#88c0d0",
			link: "#81a1c1",
			green: "#a3be8c",
			danger: "#bf616a",
			warning: "#ebcb8b",
			rail: "#242933",
			code: "#b48ead",
		},
	},
	{
		id: "solarized",
		name: "Solarized",
		note: "Ethan Schoonover's precision colors",
		light: {
			bg: "#fdf6e3",
			panel: "#f5efdc",
			sidebar: "#eee8d5",
			text: "#586e75",
			muted: "#839496",
			border: "#e4ddc8",
			accent: "#268bd2",
			link: "#268bd2",
			green: "#859900",
			danger: "#dc322f",
			warning: "#b58900",
			rail: "#073642",
			code: "#d33682",
		},
		dark: {
			bg: "#002b36",
			panel: "#073642",
			sidebar: "#00212b",
			text: "#93a1a1",
			muted: "#839496",
			border: "#0d4654",
			accent: "#268bd2",
			link: "#2aa198",
			green: "#859900",
			danger: "#dc322f",
			warning: "#b58900",
			rail: "#001b22",
			code: "#d33682",
		},
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		note: "Night and Day",
		light: {
			bg: "#e1e2e7",
			panel: "#d6d8df",
			sidebar: "#d0d5e3",
			text: "#3760bf",
			muted: "#6172b0",
			border: "#c4c8da",
			accent: "#2e7de9",
			link: "#2e7de9",
			green: "#587539",
			danger: "#f52a65",
			warning: "#8c6c3e",
			rail: "#1a1b26",
			code: "#9854f1",
		},
		dark: {
			bg: "#1a1b26",
			panel: "#1f2335",
			sidebar: "#16161e",
			text: "#c0caf5",
			muted: "#9aa5ce",
			border: "#292e42",
			accent: "#7aa2f7",
			link: "#7dcfff",
			green: "#9ece6a",
			danger: "#f7768e",
			warning: "#e0af68",
			rail: "#15161e",
			code: "#bb9af7",
		},
	},
	{
		id: "github",
		name: "GitHub",
		note: "Primer light and dark",
		light: {
			bg: "#ffffff",
			panel: "#f6f8fa",
			sidebar: "#f6f8fa",
			text: "#1f2328",
			muted: "#59636e",
			border: "#d1d9e0",
			accent: "#0969da",
			link: "#0969da",
			green: "#1f883d",
			danger: "#d1242f",
			warning: "#9a6700",
			rail: "#24292f",
			code: "#8250df",
		},
		dark: {
			bg: "#0d1117",
			panel: "#151b23",
			sidebar: "#010409",
			text: "#f0f6fc",
			muted: "#9198a1",
			border: "#3d444d",
			accent: "#4493f8",
			link: "#4493f8",
			green: "#238636",
			danger: "#f85149",
			warning: "#d29922",
			rail: "#010409",
			code: "#d2a8ff",
		},
	},
	{
		id: "rose-pine",
		name: "Ros\u00e9 Pine",
		note: "Dawn and the main pine",
		light: {
			bg: "#faf4ed",
			panel: "#fffaf3",
			sidebar: "#f2e9e1",
			text: "#575279",
			muted: "#797593",
			border: "#dfdad9",
			accent: "#907aa9",
			link: "#286983",
			green: "#286983",
			danger: "#b4637a",
			warning: "#ea9d34",
			rail: "#26233a",
			code: "#d7827e",
		},
		dark: {
			bg: "#191724",
			panel: "#1f1d2e",
			sidebar: "#1f1d2e",
			text: "#e0def4",
			muted: "#908caa",
			border: "#403d52",
			accent: "#c4a7e7",
			link: "#9ccfd8",
			green: "#31748f",
			danger: "#eb6f92",
			warning: "#f6c177",
			rail: "#13111c",
			code: "#ebbcba",
		},
	},
	{
		id: "everforest",
		name: "Everforest",
		note: "Soft forest greens",
		light: {
			bg: "#fdf6e3",
			panel: "#f4f0d9",
			sidebar: "#efebd4",
			text: "#5c6a72",
			muted: "#829181",
			border: "#e6e2cc",
			accent: "#3a94c5",
			link: "#3a94c5",
			green: "#8da101",
			danger: "#f85552",
			warning: "#dfa000",
			rail: "#2d353b",
			code: "#df69ba",
		},
		dark: {
			bg: "#2d353b",
			panel: "#343f44",
			sidebar: "#272e33",
			text: "#d3c6aa",
			muted: "#9da9a0",
			border: "#475258",
			accent: "#a7c080",
			link: "#7fbbb3",
			green: "#83c092",
			danger: "#e67e80",
			warning: "#dbbc7f",
			rail: "#232a2e",
			code: "#d699b6",
		},
	},
	{
		id: "ayu",
		name: "Ayu",
		note: "Light and dark, warm orange accents",
		light: {
			bg: "#fcfcfc",
			panel: "#f3f4f5",
			sidebar: "#f8f9fa",
			text: "#5c6166",
			muted: "#8a9199",
			border: "#e7e8e9",
			accent: "#fa8d3e",
			link: "#399ee6",
			green: "#6caf00",
			danger: "#e65050",
			warning: "#c78800",
			rail: "#1f2430",
			code: "#a37acc",
		},
		dark: {
			bg: "#0d1017",
			panel: "#131721",
			sidebar: "#0b0e14",
			text: "#bfbdb6",
			muted: "#8a8986",
			border: "#1e232b",
			accent: "#e6b450",
			link: "#59c2ff",
			green: "#7fd962",
			danger: "#d95757",
			warning: "#ffb454",
			rail: "#0b0e14",
			code: "#d2a6ff",
		},
	},
	{
		id: "night-owl",
		name: "Night Owl",
		note: "Night Owl and Light Owl",
		light: {
			bg: "#fbfbfb",
			panel: "#f0f0f0",
			sidebar: "#f6f6f6",
			text: "#403f53",
			muted: "#7a8181",
			border: "#d9d9d9",
			accent: "#4876d6",
			link: "#4876d6",
			green: "#08916a",
			danger: "#de3d3b",
			warning: "#c96765",
			rail: "#011627",
			code: "#994cc3",
		},
		dark: {
			bg: "#011627",
			panel: "#0b2942",
			sidebar: "#01111d",
			text: "#d6deeb",
			muted: "#8a9fb3",
			border: "#1d3b53",
			accent: "#82aaff",
			link: "#7fdbca",
			green: "#22da6e",
			danger: "#ef5350",
			warning: "#ecc48d",
			rail: "#010e1a",
			code: "#c792ea",
		},
	},
	{
		id: "kanagawa",
		name: "Kanagawa",
		note: "Lotus and Wave, after Hokusai",
		light: {
			bg: "#f2ecbc",
			panel: "#e7dba0",
			sidebar: "#e5ddb0",
			text: "#545464",
			muted: "#716e61",
			border: "#dcd5ac",
			accent: "#4d699b",
			link: "#4d699b",
			green: "#6f894e",
			danger: "#c84053",
			warning: "#77713f",
			rail: "#1f1f28",
			code: "#624c83",
		},
		dark: {
			bg: "#1f1f28",
			panel: "#2a2a37",
			sidebar: "#16161d",
			text: "#dcd7ba",
			muted: "#a6a69c",
			border: "#363646",
			accent: "#7e9cd8",
			link: "#7fb4ca",
			green: "#98bb6c",
			danger: "#e46876",
			warning: "#e6c384",
			rail: "#16161d",
			code: "#957fb8",
		},
	},
];

export const DEFAULT_THEME = "workplace";

function rgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `share` of `over` laid on `base`. */
function mix(base: string, over: string, share: number): string {
	const a = rgb(base);
	const b = rgb(over);
	return `#${a
		.map((channel, index) => Math.round(channel + (b[index]! - channel) * share))
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`;
}

function luminance(hex: string): number {
	const [r, g, b] = rgb(hex).map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Text that reads on a fill of `color`. */
function on(color: string): string {
	return luminance(color) > 0.4 ? "#14161a" : "#ffffff";
}

/** Every `--wp-*` variable of a variant. */
export function themeVariables(palette: Palette, dark: boolean): Record<string, string> {
	const { bg, text, accent, green, danger, rail } = palette;
	return {
		"--wp-bg": bg,
		"--wp-panel": palette.panel,
		"--wp-sidebar": palette.sidebar,
		"--wp-hover": mix(bg, text, dark ? 0.09 : 0.06),
		"--wp-selected": mix(bg, accent, dark ? 0.3 : 0.16),
		"--wp-text": text,
		"--wp-muted": palette.muted,
		"--wp-border": palette.border,
		"--wp-accent": accent,
		"--wp-link": palette.link,
		"--wp-green": green,
		"--wp-positive": dark ? mix(green, "#ffffff", luminance(green) > 0.3 ? 0 : 0.3) : green,
		"--wp-danger": danger,
		"--wp-danger-bg": mix(bg, danger, dark ? 0.16 : 0.08),
		"--wp-warning": palette.warning,
		"--wp-code": mix(bg, text, dark ? 0.07 : 0.05),
		"--wp-code-text": palette.code,
		"--wp-you-bg": mix(bg, green, dark ? 0.25 : 0.14),
		"--wp-you-text": dark ? mix(green, "#ffffff", 0.3) : mix(green, "#000000", 0.2),
		"--wp-plum": mix(rail, "#000000", 0.18),
		"--wp-rail": rail,
		"--wp-shadow": dark ? "0 8px 40px #0006" : `0 8px 40px ${text}24`,
		"--wp-on-accent": on(accent),
		"--wp-on-green": on(green),
	};
}

export function themeOf(id: string | null | undefined): Theme {
	return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}
