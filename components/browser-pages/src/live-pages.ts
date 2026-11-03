import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface LivePage {
	tool: string;
	url: string;
}

export interface LivePages {
	pid: number;
	pages: Record<string, LivePage>;
}

export function livePagesFile(sessionId: string, agentDir = getAgentDir()): string {
	return join(agentDir, "browser-pages", "live", `${sessionId}.json`);
}

function read(file: string): LivePages | undefined {
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as LivePages;
	} catch {
		return undefined;
	}
}

function write(file: string, pages: LivePages): void {
	if (!Object.keys(pages.pages).length) {
		rmSync(file, { force: true });
		return;
	}
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(pages));
	renameSync(temporary, file);
}

export function publishLivePage(sessionId: string, toolCallId: string, page: LivePage): () => void {
	const file = livePagesFile(sessionId);
	const current = read(file);
	const pages = current?.pid === process.pid ? current.pages : {};
	write(file, { pid: process.pid, pages: { ...pages, [toolCallId]: page } });
	return () => {
		const now = read(file);
		if (!now || now.pid !== process.pid) return;
		const { [toolCallId]: _closed, ...rest } = now.pages;
		write(file, { pid: process.pid, pages: rest });
	};
}

export function livePage(sessionId: string, toolCallId: string, agentDir?: string): LivePage | undefined {
	const pages = read(livePagesFile(sessionId, agentDir));
	if (!pages) return undefined;
	try {
		process.kill(pages.pid, 0);
	} catch {
		return undefined;
	}
	return pages.pages[toolCallId];
}
