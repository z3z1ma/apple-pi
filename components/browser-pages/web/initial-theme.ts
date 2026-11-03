export function initialTheme(): "light" | "dark" {
	const asked = typeof location === "object" ? new URLSearchParams(location.search).get("theme") : null;
	if (asked === "light" || asked === "dark") return asked;
	return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
