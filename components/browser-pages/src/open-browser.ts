import { execFile } from "node:child_process";

export function openInBrowser(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
	execFile(command, [url], () => {});
}
