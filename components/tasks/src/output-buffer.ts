import { randomBytes } from "node:crypto";
import { createWriteStream, rmSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@earendil-works/pi-coding-agent";

export interface OutputSnapshot {
	content: string;
	truncated: boolean;
	fullOutputPath?: string;
	totalLines: number;
	totalBytes: number;
}

export interface OutputBufferOptions {
	maxLines?: number;
	maxBytes?: number;
	tempFilePrefix?: string;
	initialText?: string;
}

export class OutputBuffer {
	private readonly maxLines: number;
	private readonly maxBytes: number;
	private readonly tempFilePrefix: string;
	private readonly decoder = new TextDecoder();
	private tailText = "";
	private totalLines = 0;
	private totalBytes = 0;
	private tempFilePath?: string;
	private tempWriteStream?: WriteStream;
	private closed = false;

	constructor(options: OutputBufferOptions = {}) {
		this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		this.tempFilePrefix = options.tempFilePrefix ?? "pi-task";
		if (options.initialText) {
			this.append(options.initialText);
		}
	}

	append(data: Buffer | string): void {
		if (this.closed) return;
		const chunk = typeof data === "string" ? Buffer.from(data, "utf8") : data;
		const text = typeof data === "string" ? data : this.decoder.decode(chunk, { stream: true });
		this.totalBytes += chunk.length;
		const lineCount = (text.match(/\n/g) || []).length;
		this.totalLines += lineCount;

		this.tailText += text;
		// Keep tail within reasonable memory bounds (approx 2x maxBytes to allow smooth tail truncation)
		if (this.tailText.length > this.maxBytes * 2) {
			this.tailText = this.tailText.slice(-this.maxBytes * 2);
		}

		// If we exceed thresholds or temp file is already open, stream to temp file
		if (this.tempWriteStream || this.totalBytes > this.maxBytes || this.totalLines > this.maxLines) {
			this.ensureTempFile();
			this.tempWriteStream?.write(chunk);
		}
	}

	finish(): void {
		if (this.closed) return;
		const remaining = this.decoder.decode();
		if (remaining) {
			this.append(remaining);
		}
		this.closeStream();
	}

	getSnapshot(): OutputSnapshot {
		const isTruncated = this.totalBytes > this.maxBytes || this.totalLines > this.maxLines;
		const truncated = truncateTail(this.tailText, {
			maxLines: this.maxLines,
			maxBytes: this.maxBytes,
		});

		return {
			content: truncated.content,
			truncated: isTruncated || truncated.truncated,
			fullOutputPath: isTruncated ? this.tempFilePath : undefined,
			totalLines: this.totalLines,
			totalBytes: this.totalBytes,
		};
	}

	private ensureTempFile(): void {
		if (this.tempFilePath && this.tempWriteStream) return;
		const id = randomBytes(8).toString("hex");
		this.tempFilePath = join(tmpdir(), `${this.tempFilePrefix}-${id}.log`);
		this.tempWriteStream = createWriteStream(this.tempFilePath, { flags: "a" });
		// Write what we have accumulated so far
		if (this.tailText.length > 0) {
			this.tempWriteStream.write(Buffer.from(this.tailText, "utf8"));
		}
	}

	private closeStream(): void {
		if (this.tempWriteStream) {
			this.tempWriteStream.end();
			this.tempWriteStream = undefined;
		}
	}

	cleanup(): void {
		this.closed = true;
		this.closeStream();
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
