import { randomBytes } from "node:crypto";
import { closeSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";
import { terminalSize } from "./terminal.js";
import { TerminalTranscript, type TranscriptLine } from "./terminal-transcript.js";

export interface OutputSnapshot {
	/** Plain text for the model, task status, and notifications. */
	content: string;
	/** The same lines with the program's colors, for terminal views. */
	styled: string;
	truncated: boolean;
	fullOutputPath?: string;
	totalLines: number;
	totalBytes: number;
}

export interface OutputBufferOptions {
	maxLines?: number;
	maxBytes?: number;
	tempFilePrefix?: string;
	/** Where the full-output file goes; the OS temporary directory by default. */
	tempDir?: string;
	initialText?: string;
}

interface StoredLine extends TranscriptLine {
	bytes: number;
}

/**
 * Collects a command's stdout and stderr as terminal output. Truncation, totals, and the full-output
 * file count plain text; the snapshot also carries the styled tail.
 */
export class OutputBuffer {
	private readonly maxLines: number;
	private readonly maxBytes: number;
	private readonly tempFilePrefix: string;
	private readonly tempDir: string;
	private readonly decoder = new TextDecoder();
	private readonly transcript = new TerminalTranscript(terminalSize().rows, (line) => this.addFinalLine(line));
	private readonly tail: StoredLine[] = [];
	private tailBytes = 0;
	private finalLines = 0;
	private finalBytes = 0;
	private tempFilePath?: string;
	private tempFile?: number;
	private unwrittenText = "";
	private closed = false;

	constructor(options: OutputBufferOptions = {}) {
		this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		this.tempFilePrefix = options.tempFilePrefix ?? "pi-task";
		this.tempDir = options.tempDir ?? tmpdir();
		if (options.initialText) {
			this.append(options.initialText);
		}
	}

	append(data: Buffer | string): void {
		if (this.closed) return;
		this.transcript.write(typeof data === "string" ? data : this.decoder.decode(data, { stream: true }));
		this.writeTempFile();
	}

	finish(): void {
		if (this.closed) return;
		this.transcript.write(this.decoder.decode());
		this.transcript.finish();
		if (this.isTruncated() && !this.tempFilePath) this.openTempFile();
		if (this.tempFile !== undefined) this.unwrittenText += this.transcript.screenLines()[0]?.plain ?? "";
		this.writeTempFile();
		this.closeTempFile();
	}

	getSnapshot(): OutputSnapshot {
		const screen = this.transcript.screenLines();
		const lines = [...this.tail, ...screen];
		const { totalLines, totalBytes } = this.totals(screen);
		const isTruncated = totalBytes > this.maxBytes || totalLines > this.maxLines;
		// The full-output file must exist whenever the snapshot is truncated; screen lines join it as they become final.
		if (isTruncated && !this.tempFilePath) {
			this.openTempFile();
			this.writeTempFile();
		}
		const truncated = truncateTail(lines.map((line) => line.plain).join("\n"), {
			maxLines: this.maxLines,
			maxBytes: this.maxBytes,
		});
		const kept = truncated.content === "" ? 0 : truncated.content.split("\n").length;
		const styledLines = lines.slice(lines.length - kept).map((line) => line.styled);
		if (truncated.lastLinePartial && styledLines.length > 0) styledLines[0] = truncated.content.split("\n")[0] ?? "";
		return {
			content: truncated.content,
			styled: styledLines.join("\n"),
			truncated: isTruncated || truncated.truncated,
			fullOutputPath: isTruncated ? this.tempFilePath : undefined,
			totalLines,
			totalBytes,
		};
	}

	private totals(screen: TranscriptLine[]): { totalLines: number; totalBytes: number } {
		return {
			// Every screen line but the last ends with a line break.
			totalLines: this.finalLines + screen.length - 1,
			totalBytes: this.finalBytes + screen.reduce((sum, line) => sum + byteLength(line.plain) + 1, -1),
		};
	}

	private isTruncated(): boolean {
		const { totalLines, totalBytes } = this.totals(this.transcript.screenLines());
		return totalBytes > this.maxBytes || totalLines > this.maxLines;
	}

	private addFinalLine(line: TranscriptLine): void {
		const stored = { ...line, bytes: byteLength(line.plain) + 1 };
		this.finalLines++;
		this.finalBytes += stored.bytes;
		this.tail.push(stored);
		this.tailBytes += stored.bytes;
		if (this.tempFile !== undefined) this.unwrittenText += `${line.plain}\n`;
		else if (this.finalBytes > this.maxBytes || this.finalLines > this.maxLines) this.openTempFile();
		// Older lines can go once the newer ones alone fill either limit; the tail snapshot cannot reach them.
		while (this.tail.length > 1) {
			const oldest = this.tail[0] as StoredLine;
			if (this.tail.length - 1 < this.maxLines && this.tailBytes - oldest.bytes < this.maxBytes) break;
			this.tail.shift();
			this.tailBytes -= oldest.bytes;
		}
	}

	private openTempFile(): void {
		if (this.closed) return;
		const id = randomBytes(8).toString("hex");
		this.tempFilePath = join(this.tempDir, `${this.tempFilePrefix}-${id}.log`);
		this.tempFile = openSync(this.tempFilePath, "a");
		this.unwrittenText = this.tail.map((line) => `${line.plain}\n`).join("");
	}

	/** Writes synchronously, once per appended chunk, so the file is complete when a command's result is read. */
	private writeTempFile(): void {
		if (this.tempFile === undefined || this.unwrittenText === "") return;
		writeSync(this.tempFile, this.unwrittenText);
		this.unwrittenText = "";
	}

	private closeTempFile(): void {
		if (this.tempFile === undefined) return;
		closeSync(this.tempFile);
		this.tempFile = undefined;
	}

	cleanup(): void {
		this.closed = true;
		this.closeTempFile();
		if (this.tempFilePath) {
			try {
				rmSync(this.tempFilePath, { force: true });
			} catch {
				// Ignore cleanup failures
			}
			this.tempFilePath = undefined;
		}
	}
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}
