import type { Mermaid } from "mermaid";

declare global {
	interface Window {
		mermaid?: Mermaid;
	}
}

let theme = "";

/** Draws every Mermaid block not yet drawn, in the page's colours; redraws all of them when the theme changes. */
export async function drawDiagrams(currentTheme: string): Promise<void> {
	const css = getComputedStyle(document.documentElement);
	const v = (name: string) => css.getPropertyValue(name).trim();
	if (theme !== currentTheme) {
		theme = currentTheme;
		for (const node of document.querySelectorAll<HTMLElement>("pre.mermaid[data-processed]")) {
			node.textContent = node.dataset.source ?? "";
			node.removeAttribute("data-processed");
		}
	}
	const nodes = [...document.querySelectorAll<HTMLElement>("pre.mermaid:not([data-processed])")];
	// The server inlines Mermaid only into pages whose document has a diagram.
	const mermaid = window.mermaid;
	if (!nodes.length || !mermaid) return;
	for (const node of nodes) node.dataset.source ??= node.textContent ?? "";
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		fontFamily: v("--font-ui"),
		flowchart: { useMaxWidth: false, nodeSpacing: 36, rankSpacing: 46, padding: 14, curve: "basis" },
		// By default a sequence diagram takes `width: 100%`, which a centred box turns into 300px of unreadable text.
		sequence: {
			useMaxWidth: false,
			wrap: true,
			width: 170,
			actorMargin: 60,
			mirrorActors: false,
			actorFontSize: 14,
			messageFontSize: 14,
			noteFontSize: 13,
		},
		themeVariables: {
			fontSize: "15px",
			primaryColor: v("--surface"),
			primaryBorderColor: v("--line-2"),
			primaryTextColor: v("--ink"),
			lineColor: v("--ink-3"),
			secondaryColor: v("--surface-3"),
			tertiaryColor: v("--surface-2"),
			edgeLabelBackground: v("--surface-2"),
			actorBkg: v("--surface"),
			actorBorder: v("--line-2"),
			actorTextColor: v("--ink"),
			signalColor: v("--ink-2"),
			signalTextColor: v("--ink"),
			noteBkgColor: v("--surface-3"),
			noteTextColor: v("--ink-2"),
			noteBorderColor: v("--line-2"),
		},
	});
	// A diagram that does not parse shows Mermaid's error in its place; the rest still draw.
	await mermaid.run({ nodes, suppressErrors: true });
}
