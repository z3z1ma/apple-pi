import { type RefObject, useEffect, useRef, useState } from "react";

import type { TutorTurn } from "../../src/page-data";
import { blockMarkdown, Icon, Kbd } from "../ui";

type Start = NonNullable<TutorTurn["start"]>;

export interface Message {
	role: "reader" | "tutor";
	text: string;
	/** The passage a reader's message is about. */
	quote?: { src: string; text: string };
	pending?: boolean;
	failed?: boolean;
}

const QUICK = ["Give me a hint", "Just tell me"];
const SUGGEST = ["Walk me through the main idea", "Quiz me on this change", "Which part is easiest to get wrong?"];

/**
 * The conversation with the tutor: the agent, answering from a read-only fork of its own conversation. Every reply
 * holds its place in the thread from the moment it is asked, so answers stay in order.
 */
export function useTutor(token: string, onFailure: () => void) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"socratic" | "direct">("socratic");
	const [messages, setMessages] = useState<Message[]>([]);
	const start = useRef<Start | undefined>(undefined);
	const thread = useRef<Message[]>([]);
	thread.current = messages;

	const send = (text: string, quote?: Message["quote"]) => {
		const message = text.trim();
		if (!message) return;
		const prior = thread.current
			.filter((m) => !m.pending && !m.failed)
			.map((m) => ({ role: m.role, text: m.quote ? `${m.text} (about: "${m.quote.text}")` : m.text }));
		const index = thread.current.length + 1;
		setMessages((ms) => [...ms, { role: "reader", text: message, quote }, { role: "tutor", text: "", pending: true }]);
		const settle = (reply: Partial<Message>) =>
			setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, ...reply, pending: false } : m)));
		fetch("/ask", {
			method: "POST",
			headers: { "content-type": "application/json", "x-page-token": token },
			body: JSON.stringify({ message, mode, thread: prior, start: start.current }),
		})
			.then(async (r) => {
				if (r.ok) return settle({ text: ((await r.json()) as { answer?: string }).answer ?? "" });
				settle({ text: `The tutor could not answer: ${await r.text()}`, failed: true });
				onFailure();
			})
			.catch(() => {
				settle({
					text: "The tutor is no longer reachable: the session that wrote this explanation has ended.",
					failed: true,
				});
				onFailure();
			});
	};
	/** Opens the sidebar on a new line of conversation that starts from `from`. */
	const begin = (text: string, from: Start, quote?: Message["quote"]) => {
		start.current = from;
		setOpen(true);
		send(text, quote);
	};
	const asked = messages.filter((m) => m.role === "reader" && !QUICK.includes(m.text)).map((m) => m.text);
	return { open, setOpen, mode, setMode, messages, send, begin, asked };
}

/** Tutor text as Markdown, with "Step 2", "Question 3", and "Figure 1" turned into links to them. */
function tutorHtml(text: string): string {
	return blockMarkdown(text).replace(
		/(^|>)([^<]*)/g,
		(_, edge: string, chunk: string) =>
			edge +
			chunk.replace(
				/\b(Step|Question|Figure) (\d+)\b/g,
				'<button type="button" class="ex-cite" data-cite="$1-$2">$1 $2</button>',
			),
	);
}

export function Sidebar({
	tutor,
	onCite,
}: {
	tutor: ReturnType<typeof useTutor>;
	onCite: (kind: string, n: number) => void;
}) {
	const { messages, mode, setMode, send } = tutor;
	const aside = useRef<HTMLElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		body.current?.scrollTo({ top: body.current.scrollHeight });
	});
	useEffect(() => {
		input.current?.focus();
	}, []);
	const submit = () => {
		if (!input.current) return;
		send(input.current.value);
		input.current.value = "";
	};
	const last = messages.at(-1);
	return (
		<aside className="ex-chat" ref={aside}>
			<Grip sidebar={aside} />
			<div className="ex-chat-h">
				<Icon.spark />
				<b>Talk it through</b>
				<div className="seg">
					<button type="button" className={mode === "socratic" ? "on" : ""} onClick={() => setMode("socratic")}>
						Socratic
					</button>
					<button type="button" className={mode === "direct" ? "on" : ""} onClick={() => setMode("direct")}>
						Direct
					</button>
				</div>
				<span className="sp" />
				<button type="button" className="icon-btn" title="Close (Esc)" onClick={() => tutor.setOpen(false)}>
					<Icon.x />
				</button>
			</div>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: citation links are buttons; this only routes their clicks. */}
			<div
				className="ex-chat-b"
				ref={body}
				onClick={(e) => {
					const cite = (e.target as Element).closest<HTMLElement>(".ex-cite");
					const [kind, n] = cite?.dataset.cite?.split("-") ?? [];
					if (cite) onCite(kind, Number(n));
				}}
			>
				{messages.length === 0 ? (
					<div className="ex-chat-empty">
						<div className="big">
							<Icon.spark />
						</div>
						<p>Ask anything about this change.</p>
						<p className="dim">
							{mode === "socratic"
								? "In Socratic mode the tutor answers with questions that lead you to the answer, one step at a time, with a hint whenever you want one."
								: "In Direct mode the tutor answers plainly and points to the step."}
						</p>
						<div className="ex-replies col">
							{SUGGEST.map((q) => (
								<button type="button" key={q} onClick={() => send(q)}>
									{q}
								</button>
							))}
						</div>
						<p className="dim small">
							Also: select text in the explanation, use <b>Check my understanding</b> after a step, or{" "}
							<b>Talk it through</b> after a missed question.
						</p>
					</div>
				) : null}
				{messages.map((m, i) =>
					m.role === "reader" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: the thread only grows.
						<div className="ex-m you" key={i}>
							{m.quote ? (
								<div className="ex-quote">
									<span className="src">{m.quote.src}</span>
									{m.quote.text}
								</div>
							) : null}
							<div className="body">{m.text}</div>
						</div>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: the thread only grows.
						<div className={`ex-m tutor ${m.failed ? "failed" : ""}`} key={i}>
							<div className="who">
								<Icon.spark /> Tutor
							</div>
							{m.pending ? (
								<div className="ex-dots">
									<i />
									<i />
									<i />
								</div>
							) : (
								// biome-ignore lint/security/noDangerouslySetInnerHtml: blockMarkdown escapes the text before adding tags.
								<div className="body" dangerouslySetInnerHTML={{ __html: tutorHtml(m.text) }} />
							)}
							{m === last && !m.pending && !m.failed && mode === "socratic" ? (
								<div className="ex-replies">
									{QUICK.map((q) => (
										<button type="button" key={q} onClick={() => send(q)}>
											{q}
										</button>
									))}
								</div>
							) : null}
						</div>
					),
				)}
			</div>
			<div className="ex-chat-c">
				<textarea
					ref={input}
					rows={2}
					placeholder={mode === "socratic" ? "Answer, or ask something…" : "Ask something…"}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit();
						}
						if (e.key === "Escape") tutor.setOpen(false);
					}}
				/>
				<button type="button" className="btn primary sm" title="Send (↵)" onClick={submit}>
					<Icon.send />
				</button>
			</div>
		</aside>
	);
}

/** The sidebar's left edge. Its width lives in `--chat-w` on the page grid, so it stays when the sidebar closes. */
function Grip({ sidebar }: { sidebar: RefObject<HTMLElement | null> }) {
	const grid = () => sidebar.current?.parentElement;
	const resize = (width: number | undefined) => {
		if (width === undefined) return grid()?.style.removeProperty("--chat-w");
		// Wide enough for the header, narrow enough to leave the article room.
		const px = Math.max(320, Math.min(width, innerWidth - 640));
		grid()?.style.setProperty("--chat-w", `${Math.round(px)}px`);
	};
	const edge = () => sidebar.current?.getBoundingClientRect();
	return (
		<button
			type="button"
			className="ex-chat-grip"
			aria-label="Resize the sidebar"
			title="Drag to resize · double-click to reset"
			onPointerDown={(e) => {
				e.currentTarget.setPointerCapture(e.pointerId);
				grid()?.classList.add("resizing");
			}}
			onPointerMove={(e) => {
				const box = edge();
				if (box && e.currentTarget.hasPointerCapture(e.pointerId)) resize(box.right - e.clientX);
			}}
			onLostPointerCapture={() => grid()?.classList.remove("resizing")}
			onDoubleClick={() => resize(undefined)}
			onKeyDown={(e) => {
				const step = e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
				// The set width, not the rendered one: the column animates toward it.
				const width = Number.parseFloat(grid()?.style.getPropertyValue("--chat-w") ?? "") || edge()?.width;
				if (!step || width === undefined) return;
				e.preventDefault();
				resize(width + step);
			}}
		/>
	);
}

export function Launcher({ onOpen }: { onOpen: () => void }) {
	return (
		<button type="button" className="ex-launch" onClick={onOpen}>
			<Icon.bubble />
			<span>Talk it through</span>
			<Kbd>/</Kbd>
		</button>
	);
}
