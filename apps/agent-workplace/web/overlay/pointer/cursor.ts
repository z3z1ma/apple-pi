export type CursorKind = "walk" | "act" | "blocked";
export type CursorArt = "cursor-point" | "cursor-tap" | "cursor-blocked";
export const CURSOR_ART: readonly CursorArt[] = ["cursor-point", "cursor-tap", "cursor-blocked"];

const HAND_HEIGHT = 30;

const POINT_MS = 460;
const TAP_MS = 220;

const FALLBACK = "pointer";

export function cursorArt(kind: CursorKind, time: number): CursorArt {
	if (kind === "blocked") return "cursor-blocked";
	if (kind === "walk") return "cursor-point";
	return time % (POINT_MS + TAP_MS) < POINT_MS ? "cursor-point" : "cursor-tap";
}

export function fingertip(alpha: ArrayLike<number>, width: number, height: number): [number, number] {
	const seen = new Uint8Array(width * height);
	let best: number[] = [];
	for (let start = 0; start < width * height; start++) {
		if (seen[start] || alpha[start] < 128) continue;
		const shape: number[] = [];
		const stack = [start];
		seen[start] = 1;
		while (stack.length) {
			const at = stack.pop()!;
			shape.push(at);
			const x = at % width;
			const next = [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width];
			for (const n of next)
				if (n >= 0 && n < width * height && !seen[n] && alpha[n] >= 128) {
					seen[n] = 1;
					stack.push(n);
				}
		}
		if (shape.length > best.length) best = shape;
	}
	let tip: [number, number] = [0, 0];
	let nearest = Infinity;
	for (const at of best) {
		const x = at % width;
		const y = Math.floor(at / width);
		if (x + y < nearest) {
			nearest = x + y;
			tip = [x, y];
		}
	}
	return tip;
}

const loadImage = (url: string) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`could not load ${url}`));
		image.src = url;
	});

function scaled(image: HTMLImageElement, scale: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(image.width * scale));
	canvas.height = Math.max(1, Math.round(image.height * scale));
	const context = canvas.getContext("2d")!;
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL("image/png");
}

async function cursorFor(url: string, scale: number, point?: HTMLImageElement): Promise<string> {
	const image = point ?? (await loadImage(url));
	const probe = document.createElement("canvas");
	probe.width = image.width;
	probe.height = image.height;
	const context = probe.getContext("2d", { willReadFrequently: true })!;
	context.drawImage(image, 0, 0);
	const rgba = context.getImageData(0, 0, image.width, image.height).data;
	const alpha = new Uint8Array(image.width * image.height);
	for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
	const [tx, ty] = fingertip(alpha, image.width, image.height);
	const hx = Math.round(tx * scale);
	const hy = Math.round(ty * scale);
	return `image-set(url("${scaled(image, scale)}") 1x, url("${scaled(image, scale * 2)}") 2x) ${hx} ${hy}, ${FALLBACK}`;
}

const built = new Map<string, Promise<Record<CursorArt, string>>>();

async function build(packUrl: string): Promise<Record<CursorArt, string>> {
	const point = await loadImage(`${packUrl}overlays/cursor-point.png`);
	const scale = HAND_HEIGHT / point.height;
	const [p, t, b] = await Promise.all(
		CURSOR_ART.map((art) =>
			cursorFor(`${packUrl}overlays/${art}.png`, scale, art === "cursor-point" ? point : undefined),
		),
	);
	return { "cursor-point": p, "cursor-tap": t, "cursor-blocked": b };
}

const ready = new Map<string, Record<CursorArt, string>>();

export function cursorCss(packUrl: string, art: CursorArt): string {
	const done = ready.get(packUrl);
	if (done) return done[art];
	if (!built.has(packUrl)) {
		const making = build(packUrl);
		built.set(packUrl, making);
		making.then(
			(cursors) => ready.set(packUrl, cursors),
			() => {},
		);
	}
	return FALLBACK;
}
