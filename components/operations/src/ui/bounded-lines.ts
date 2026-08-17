import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function clampLine(line: string, width: number): string {
	if (width <= 0) return "";
	return truncateToWidth(line, width, "");
}

export function clampLines(lines: string[], width: number, height?: number): string[] {
	const fitted = lines.map((line) => clampLine(line, width));
	if (height === undefined || height < 0 || fitted.length <= height) return fitted;
	if (height === 0) return [];
	if (height === 1) return [clampLine(`… ${fitted.length} lines`, width)];
	const visible = fitted.slice(0, height - 1);
	visible.push(clampLine(`… ${fitted.length - visible.length} more`, width));
	return visible;
}

export function rightAlign(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const maxLeft = Math.max(0, width - rightWidth - 1);
	const leftClamped = truncateToWidth(left, maxLeft);
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightWidth);
	return truncateToWidth(`${leftClamped}${" ".repeat(gap)}${right}`, width);
}
