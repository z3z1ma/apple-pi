import { extname, join, normalize, sep } from "node:path";

export function appFile(appDir: string, pathname: string): string | undefined {
	const path = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
	if (path.split(sep).includes("..")) return undefined;
	if (path.startsWith(`themes${sep}`)) return join(appDir, path);
	return join(appDir, "dist", "web", path || "index.html");
}

const TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

export function contentType(file: string): string {
	return TYPES[extname(file)] ?? "application/octet-stream";
}
