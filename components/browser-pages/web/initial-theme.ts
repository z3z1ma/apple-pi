import { useEffect, useRef } from "react";

type Theme = "light" | "dark";

export function initialTheme(): Theme {
	const asked = typeof location === "object" ? new URLSearchParams(location.search).get("theme") : null;
	if (asked === "light" || asked === "dark") return asked;
	return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useEmbedderTheme(apply: (theme: Theme) => void): void {
	const latest = useRef(apply);
	latest.current = apply;
	useEffect(() => {
		if (window.parent === window) return;
		const listen = (event: MessageEvent) => {
			const data = event.data as { type?: unknown; theme?: unknown } | null;
			if (event.source !== window.parent || data?.type !== "apple-pi:theme") return;
			if (data.theme === "light" || data.theme === "dark") latest.current(data.theme);
		};
		window.addEventListener("message", listen);
		return () => window.removeEventListener("message", listen);
	}, []);
}
