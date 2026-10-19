// The transcript on the book's right page: the operator's turns and the agent's replies as Markdown, consecutive
// replies of one turn under one heading, each tool call folded to one line (its tool and main argument) that opens to
// its input and result, mail as a sealed letter, and other extensions' messages folded like tool calls.
import { createContext, memo, useContext, useState } from "react";
import type { TranscriptEntry, TranscriptToolCall } from "../../../src/world.js";
import { markdownHtml } from "./markdown.js";

type ToolResult = Extract<TranscriptEntry, { kind: "tool-result" }>;
type Assistant = Extract<TranscriptEntry, { kind: "assistant" }>;

/** What the transcript draws: the operator's turn, a run of the agent's replies, mail, a note, or a lone result. */
export type Block =
	| { kind: "user"; entry: Extract<TranscriptEntry, { kind: "user" }> }
	| { kind: "agent"; entries: Assistant[] }
	| { kind: "mail"; entry: Extract<TranscriptEntry, { kind: "mail" }> }
	| { kind: "note"; entry: Extract<TranscriptEntry, { kind: "note" }> }
	| { kind: "result"; entry: ToolResult };

/**
 * Group entries for drawing: consecutive replies (with the tool results between them) form one block, and a tool result
 * goes with its call. A result whose call is not loaded yet (on an older page) stands alone until it is.
 */
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

/** "Today", "Yesterday", or the date, for the divider where a new day starts. */
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

const Markdown = memo(function Markdown({ text }: { text: string }) {
	// The HTML comes from markdownHtml, which escapes every raw tag and drops links and images.
	// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by markdownHtml
	return <div className="aw-md" dangerouslySetInnerHTML={{ __html: markdownHtml(text) }} />;
});

/** A folded line that opens on click: a tool call with its result, a thought, or an extension's note. */
function Fold({
	className,
	glyph,
	label,
	arg,
	state,
	children,
}: {
	className: string;
	glyph: string;
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
				<span className="aw-conv-glyph" aria-hidden="true">
					{glyph}
				</span>
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

/** The character's working directory, which tool lines leave out of the paths and commands they show. */
export const WorkingDirectory = createContext<string | undefined>(undefined);

/** A main argument as the line shows it: without a leading `cd <dir> &&` into the working directory, paths relative. */
export function shortArg(arg: string | null, cwd: string | undefined): string | null {
	if (!arg || !cwd) return arg;
	const dir = cwd.replace(/\/+$/, "");
	let shown = arg;
	for (const quote of ["", '"', "'"]) {
		const prefix = `cd ${quote}${dir}${quote} && `;
		if (shown.startsWith(prefix)) shown = shown.slice(prefix.length);
	}
	return shown.split(`${dir}/`).join("") || arg;
}

function ToolCall({ call, result }: { call: TranscriptToolCall; result?: ToolResult }) {
	const cwd = useContext(WorkingDirectory);
	return (
		<Fold
			className="aw-conv-tool"
			glyph={"\u2692"}
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

function ResultText({ result }: { result: ToolResult }) {
	return (
		<>
			<pre className={`aw-conv-io${result.isError ? " aw-conv-error" : ""}`}>
				{result.text.replace(/^\s*\n/, "").trimEnd() || "(no output)"}
			</pre>
			{result.cut && <p className="aw-conv-quiet">Cut short here; the whole output is in its terminal.</p>}
		</>
	);
}

function AgentBlock({
	name,
	entries,
	results,
}: {
	name: string;
	entries: Assistant[];
	results: Map<string, ToolResult>;
}) {
	return (
		<article className="aw-conv-entry aw-conv-assistant" data-entry={entries[0].id}>
			<header className="aw-conv-who">
				<span className="aw-conv-name">{name}</span>
				<time>{clock(entries[0].at)}</time>
			</header>
			{entries.map((entry) => (
				<div key={entry.id} className="aw-conv-reply" data-entry={entry === entries[0] ? undefined : entry.id}>
					{entry.parts.map((part, index) => {
						const key = `${entry.id}:${index}`;
						if (part.kind === "text") return <Markdown key={key} text={part.text} />;
						if (part.kind === "thinking")
							return (
								<Fold key={key} className="aw-conv-thought" glyph={"\u2767"} label="Thought it over">
									<p className="aw-conv-thought-text">{part.text || "The thought is hidden."}</p>
								</Fold>
							);
						return <ToolCall key={key} call={part.call} result={results.get(part.call.id)} />;
					})}
					{entry.error && <p className="aw-conv-failed">The reply failed: {entry.error}</p>}
					{entry.aborted && <p className="aw-conv-failed">Stopped before it finished.</p>}
				</div>
			))}
		</article>
	);
}

export const BlockView = memo(function BlockView({
	block,
	name,
	results,
}: {
	block: Block;
	name: string;
	results: Map<string, ToolResult>;
}) {
	if (block.kind === "agent") return <AgentBlock name={name} entries={block.entries} results={results} />;
	if (block.kind === "user")
		return (
			<article className="aw-conv-entry aw-conv-user" data-entry={block.entry.id}>
				<header className="aw-conv-who">
					<span className="aw-conv-name">You</span>
					<time>{clock(block.entry.at)}</time>
				</header>
				<Markdown text={block.entry.text} />
				{block.entry.images > 0 && (
					<p className="aw-conv-quiet">
						{block.entry.images === 1 ? "With an image" : `With ${block.entry.images} images`} (see its terminal).
					</p>
				)}
			</article>
		);
	if (block.kind === "mail")
		return (
			<article className="aw-conv-entry aw-conv-mail" data-entry={block.entry.id}>
				<span className="aw-conv-seal" aria-hidden="true" />
				<header className="aw-conv-who">
					<span className="aw-conv-name">Mail from {block.entry.from}</span>
					<time>{clock(block.entry.at)}</time>
				</header>
				<Markdown text={block.entry.text} />
			</article>
		);
	if (block.kind === "note")
		return (
			<div className="aw-conv-entry aw-conv-note" data-entry={block.entry.id}>
				<Fold
					className="aw-conv-tool"
					glyph={"\u2709"}
					label={block.entry.shown ? block.entry.label : `${block.entry.label} (for the agent only)`}
				>
					<pre className="aw-conv-io">{block.entry.text || "(empty)"}</pre>
				</Fold>
			</div>
		);
	return (
		<div className="aw-conv-entry aw-conv-orphan" data-entry={block.entry.id}>
			<Fold
				className="aw-conv-tool"
				glyph={"\u2692"}
				label={`${block.entry.tool} result`}
				state={block.entry.isError ? "error" : "ok"}
			>
				<ResultText result={block.entry} />
			</Fold>
		</div>
	);
});
