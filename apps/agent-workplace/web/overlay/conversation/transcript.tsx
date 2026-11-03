import { type ComponentType, createContext, memo, type ReactNode, useContext, useState } from "react";
import type { TranscriptEntry, TranscriptToolCall } from "../../../src/world.js";
import { FileReferenceCwd, useFileReferenceHtml } from "../../file-references.js";
import { shortArg } from "../tool-line.js";
import { isLive } from "./live-reply.js";
import { markdownHtml } from "./markdown.js";

type ToolResult = Extract<TranscriptEntry, { kind: "tool-result" }>;
type Assistant = Extract<TranscriptEntry, { kind: "assistant" }>;

export type Block =
	| { kind: "user"; entry: Extract<TranscriptEntry, { kind: "user" }> }
	| { kind: "agent"; entries: Assistant[] }
	| { kind: "mail"; entry: Extract<TranscriptEntry, { kind: "mail" }> }
	| { kind: "note"; entry: Extract<TranscriptEntry, { kind: "note" }> }
	| { kind: "result"; entry: ToolResult };

export function blocksOf(entries: TranscriptEntry[]): { blocks: Block[]; results: Map<string, ToolResult> } {
	const results = new Map<string, ToolResult>();
	const calls = new Set<string>();
	for (const entry of entries) {
		if (entry.kind === "tool-result") results.set(entry.callId, entry);
		if (entry.kind === "assistant") for (const part of entry.parts) if (part.kind === "tool") calls.add(part.call.id);
	}
	const blocks: Block[] = [];
	for (const entry of entries) {
		const last = blocks.at(-1);
		if (entry.kind === "assistant") {
			if (last?.kind === "agent") last.entries.push(entry);
			else blocks.push({ kind: "agent", entries: [entry] });
		} else if (entry.kind === "tool-result") {
			if (!calls.has(entry.callId)) blocks.push({ kind: "result", entry });
		} else if (entry.kind === "user") blocks.push({ kind: "user", entry });
		else if (entry.kind === "mail") blocks.push({ kind: "mail", entry });
		else blocks.push({ kind: "note", entry });
	}
	return { blocks, results };
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function clock(at: number) {
	return at ? TIME.format(at) : "";
}

export function dayName(at: number, now = Date.now()): string {
	const day = (t: number) => new Date(t).toDateString();
	if (day(at) === day(now)) return "Today";
	if (day(at) === day(now - 86_400_000)) return "Yesterday";
	return DAY.format(at);
}

export function blockAt(block: Block): number {
	return block.kind === "agent" ? block.entries[0].at : block.entry.at;
}

export function blockKey(block: Block): string {
	return block.kind === "agent" ? block.entries[0].id : block.entry.id;
}

export const Markdown = memo(function Markdown({
	text,
	onLink,
}: {
	text: string;
	onLink?: (href: string, file: boolean) => void;
}) {
	const references = useFileReferenceHtml(markdownHtml(text));
	const follow = (event: React.MouseEvent) => {
		if (references.follow(event)) return;
		if (!onLink || event.button > 1) return;
		const anchor =
			event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.aw-md-link[href]") : null;
		if (!anchor) return;
		event.preventDefault();
		onLink(anchor.getAttribute("href")!, anchor.hasAttribute("data-file"));
	};
	const html = references.html;
	const body = (
		// biome-ignore lint/a11y/noStaticElementInteractions: delegates native anchor activation
		// biome-ignore lint/a11y/useKeyWithClickEvents: native anchors emit clicks for Enter
		<div
			className="aw-md"
			onClick={follow}
			onAuxClick={follow}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: escaped Markdown with controlled local-file anchors
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
	return (
		<>
			{body}
			{references.error && <p role="status">File links unavailable: {references.error}</p>}
		</>
	);
});

function Fold({
	className,
	glyph,
	label,
	arg,
	state,
	children,
}: {
	className: string;

	glyph: "tool" | "thought" | "note";
	label: string;
	arg?: string | null;
	state?: "ok" | "error" | "waiting";
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className={`aw-conv-fold ${className}${open ? " aw-open" : ""}`}>
			<button type="button" className="aw-conv-fold-line" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className="aw-conv-chevron" aria-hidden="true" />
				<span className={`aw-conv-glyph aw-conv-glyph-${glyph}`} aria-hidden="true" />
				<span className="aw-conv-fold-label">{label}</span>
				{arg && <code className="aw-conv-fold-arg">{arg}</code>}
				{state && (
					<span className={`aw-conv-state aw-conv-state-${state}`} title={STATE_TITLE[state]}>
						{STATE_MARK[state]}
					</span>
				)}
			</button>
			{open && <div className="aw-conv-fold-body">{children}</div>}
		</div>
	);
}

const STATE_MARK = { ok: "\u2713", error: "\u2717", waiting: "\u2026" };
const STATE_TITLE = { ok: "Done", error: "Failed", waiting: "No result yet" };

export const WorkingDirectory = createContext<string | undefined>(undefined);

export interface TranscriptMessageInfo {
	speaker: "assistant" | "user" | "mail";
	author: string;
	at: number;
	text: string;

	reactions?: { emoji: string; people: string[] }[];
}

export const TranscriptMessage = createContext<
	ComponentType<{ message: TranscriptMessageInfo; className: string; entry: string; children: ReactNode }> | undefined
>(undefined);

function MessageArticle({
	message,
	className,
	entry,
	children,
}: {
	message: TranscriptMessageInfo;
	className: string;
	entry: string;
	children: ReactNode;
}) {
	const Wrap = useContext(TranscriptMessage);
	if (Wrap)
		return (
			<Wrap message={message} className={className} entry={entry}>
				{children}
			</Wrap>
		);
	return (
		<article className={className} data-entry={entry}>
			{children}
		</article>
	);
}
export const TranscriptAuthor = createContext<((speaker: "assistant" | "user", name: string) => ReactNode) | undefined>(
	undefined,
);

function Author({ speaker, name }: { speaker: "assistant" | "user"; name: string }) {
	const render = useContext(TranscriptAuthor);
	return render ? render(speaker, name) : <span className="aw-conv-name">{name}</span>;
}

function ToolCall({ call, result }: { call: TranscriptToolCall; result?: ToolResult }) {
	const cwd = useContext(WorkingDirectory);
	return (
		<Fold
			className="aw-conv-tool"
			glyph="tool"
			label={call.name}
			arg={shortArg(call.arg, cwd)}
			state={result ? (result.isError ? "error" : "ok") : "waiting"}
		>
			<div className="aw-conv-io-label">Input</div>
			<pre className="aw-conv-io">{call.input}</pre>
			<div className="aw-conv-io-label">Result</div>
			{result ? <ResultText result={result} /> : <p className="aw-conv-quiet">No result recorded yet.</p>}
		</Fold>
	);
}

export function trimBlankLines(text: string): string {
	return text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

function ResultText({ result }: { result: ToolResult }) {
	return (
		<>
			<pre className={`aw-conv-io${result.isError ? " aw-conv-error" : ""}`}>
				{trimBlankLines(result.text) || "(no output)"}
			</pre>
			{result.cut && <p className="aw-conv-quiet">Cut short here; the whole output is in its terminal.</p>}
		</>
	);
}

type ReplyItem =
	| { kind: "text"; key: string; text: string }
	| { kind: "thoughts"; key: string; texts: string[] }
	| { kind: "tool"; key: string; call: TranscriptToolCall };

function replyItems(entries: Assistant[]): Map<string, ReplyItem[]> {
	const items = new Map<string, ReplyItem[]>();
	let run: Extract<ReplyItem, { kind: "thoughts" }> | undefined;
	for (const entry of entries) {
		const mine: ReplyItem[] = [];
		items.set(entry.id, mine);
		entry.parts.forEach((part, index) => {
			const key = `${entry.id}:${index}`;
			if (part.kind === "thinking") {
				const text = trimBlankLines(part.text);
				if (!text) return;
				if (run) run.texts.push(text);
				else {
					run = { kind: "thoughts", key, texts: [text] };
					mine.push(run);
				}
				return;
			}
			if (part.kind === "text" && !part.text.trim()) return;
			run = undefined;
			mine.push(part.kind === "text" ? { kind: "text", key, text: part.text } : { kind: "tool", key, call: part.call });
		});
		if (entry.error || entry.aborted) run = undefined;
	}
	return items;
}

export function blockVisible(block: Block, showTools: boolean): boolean {
	if (showTools) return true;
	if (block.kind === "user") return !!block.entry.text.trim();
	return (
		block.kind === "agent" &&
		block.entries.some((entry) => entry.parts.some((part) => part.kind === "text" && part.text.trim()))
	);
}

function AgentBlock({
	name,
	entries,
	results,
	showTools,
}: {
	name: string;
	entries: Assistant[];
	results: Map<string, ToolResult>;
	showTools: boolean;
}) {
	const items = replyItems(entries);
	const visibleEntries = entries.filter(
		(entry) => showTools || items.get(entry.id)!.some((item) => item.kind === "text"),
	);
	const words = visibleEntries
		.flatMap((entry) => items.get(entry.id)!.flatMap((item) => (item.kind === "text" ? [item.text] : [])))
		.join("\n\n");
	return (
		<MessageArticle
			className="aw-conv-entry aw-conv-assistant"
			entry={entries[0].id}
			message={{ speaker: "assistant", author: name, at: entries[0].at, text: words, reactions: entries[0].reactions }}
		>
			<header className="aw-conv-who">
				<Author speaker="assistant" name={name} />
				<time>{clock(entries[0].at)}</time>
			</header>
			{visibleEntries.map((entry) => (
				<div
					key={entry.id}
					className={`aw-conv-reply${isLive(entry.id) ? " aw-conv-writing" : ""}`}
					data-entry={entry === entries[0] ? undefined : entry.id}
				>
					{items.get(entry.id)!.map((item) => {
						if (item.kind === "text") return <Markdown key={item.key} text={item.text} />;
						if (!showTools) return null;
						if (item.kind === "thoughts")
							return (
								<Fold key={item.key} className="aw-conv-thought" glyph="thought" label="Thought it over">
									{item.texts.map((text, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: thoughts in a run never reorder
										<p key={i} className="aw-conv-thought-text">
											{text}
										</p>
									))}
								</Fold>
							);
						return <ToolCall key={item.key} call={item.call} result={results.get(item.call.id)} />;
					})}
					{showTools && entry.error && <p className="aw-conv-failed">The reply failed: {entry.error}</p>}
					{showTools && entry.aborted && <p className="aw-conv-failed">Stopped before it finished.</p>}
				</div>
			))}
		</MessageArticle>
	);
}

export const BlockView = memo(function BlockView({
	block,
	name,
	results,
	showTools = true,
}: {
	block: Block;
	name: string;
	results: Map<string, ToolResult>;
	showTools?: boolean;
}) {
	if (!blockVisible(block, showTools)) return null;
	if (block.kind === "agent")
		return <AgentBlock name={name} entries={block.entries} results={results} showTools={showTools} />;
	if (block.kind === "user")
		return (
			<MessageArticle
				className="aw-conv-entry aw-conv-user"
				entry={block.entry.id}
				message={{
					speaker: "user",
					author: "You",
					at: block.entry.at,
					text: block.entry.text,
					reactions: block.entry.reactions,
				}}
			>
				<header className="aw-conv-who">
					<Author speaker="user" name="You" />
					<time>{clock(block.entry.at)}</time>
				</header>
				<Markdown text={block.entry.text} />
				{showTools && block.entry.images > 0 && (
					<p className="aw-conv-quiet">
						{block.entry.images === 1 ? "With an image" : `With ${block.entry.images} images`} (see its terminal).
					</p>
				)}
			</MessageArticle>
		);
	if (block.kind === "mail")
		return (
			<MessageArticle
				className="aw-conv-entry aw-conv-mail"
				entry={block.entry.id}
				message={{
					speaker: "mail",
					author: block.entry.from,
					at: block.entry.at,
					text: block.entry.text,
					reactions: block.entry.reactions,
				}}
			>
				<span className="aw-conv-mail-mark" aria-hidden="true" />
				<header className="aw-conv-who">
					<span className="aw-conv-name">Mail from {block.entry.from}</span>
					<time>{clock(block.entry.at)}</time>
				</header>
				<FileReferenceCwd.Provider value={undefined}>
					<Markdown text={block.entry.text} />
				</FileReferenceCwd.Provider>
			</MessageArticle>
		);
	if (block.kind === "note")
		return (
			<div className="aw-conv-entry aw-conv-note" data-entry={block.entry.id}>
				<Fold
					className="aw-conv-tool"
					glyph="note"
					label={block.entry.shown ? block.entry.label : `${block.entry.label} (for the agent only)`}
				>
					<pre className="aw-conv-io">{trimBlankLines(block.entry.text) || "(empty)"}</pre>
				</Fold>
			</div>
		);
	return (
		<div className="aw-conv-entry aw-conv-orphan" data-entry={block.entry.id}>
			<Fold
				className="aw-conv-tool"
				glyph="tool"
				label={`${block.entry.tool} result`}
				state={block.entry.isError ? "error" : "ok"}
			>
				<ResultText result={block.entry} />
			</Fold>
		</div>
	);
});
