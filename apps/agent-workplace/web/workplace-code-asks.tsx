import type { editor, IDisposable } from "monaco-editor";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConversationMessage } from "../src/communications.js";
import type { WorldSnapshot } from "../src/world.js";
import { Markdown } from "./overlay/conversation/transcript.js";

const api = window.agentWorkplace;
const POLL_MS = 3000;
const OPERATOR = "operator";

export type AskKind = "desk" | "author" | "review" | "fix";

interface CodeAsk {
	id: string;
	kind: AskKind;
	root: string;
	path: string;
	start: number;
	end: number;
	code: string;
	language: string;
	state: "draft" | "sending" | "sent" | "failed";
	to?: string;
	thread?: string;
	review?: string;
	error?: string;
}

interface ReviewFindingRow {
	finding: { title: string; path: string; line: number; severity: string };
	validation: { disposition: string } | null;
}

const ACTIONS: { kind: AskKind; label: string; placeholder: string; send: string }[] = [
	{ kind: "desk", label: "Agents: Ask the Desk", placeholder: "Ask the desk about this code", send: "Ask the desk" },
	{
		kind: "author",
		label: "Agents: Ask Whoever Wrote This",
		placeholder: "Ask the agent that last edited this file",
		send: "Ask the author",
	},
	{
		kind: "review",
		label: "Agents: Review This",
		placeholder: "What should the review focus on?",
		send: "Start review",
	},
	{
		kind: "fix",
		label: "Agents: Fix or Change This",
		placeholder: "Describe the change you want",
		send: "Hand to an engineer",
	},
];

const actionOf = (kind: AskKind) => ACTIONS.find((action) => action.kind === kind)!;

export function askBody(ask: CodeAsk, request: string): string {
	const where = `\`${ask.root}/${ask.path}\` lines ${ask.start}-${ask.end}`;
	const lead =
		ask.kind === "fix"
			? `Please have an engineer make this change in ${where}, and reply here with who took it and the commit when it is done.`
			: ask.kind === "author"
				? `You last edited ${where}. A question about it:`
				: `About ${where}:`;
	const code = ask.code ? `\n\n\`\`\`${ask.language}\n${ask.code}\n\`\`\`` : "";
	return `${lead}\n\n${request}${code}`;
}

function subjectOf(ask: CodeAsk): string {
	const prefix = ask.kind === "fix" ? "Change request" : "Code question";
	return `${prefix}: ${ask.path}:${ask.start}-${ask.end}`;
}

function AskThread({
	ask,
	visible,
	onSend,
	onClose,
	onReveal,
	onOpenReviews,
}: {
	ask: CodeAsk;
	visible: boolean;
	onSend(text: string): void;
	onClose(): void;
	onReveal(line: number): void;
	onOpenReviews(): void;
}) {
	const action = actionOf(ask.kind);
	const [draft, setDraft] = useState("");
	const [messages, setMessages] = useState<ConversationMessage[]>([]);
	const [findings, setFindings] = useState<ReviewFindingRow[]>();
	const [reviewState, setReviewState] = useState<string>();
	const [reply, setReply] = useState("");
	const input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (ask.state === "draft") input.current?.focus();
	}, [ask.state]);
	useEffect(() => {
		if (!visible || ask.state !== "sent") return;
		let stopped = false;
		const refresh = async () => {
			if (ask.thread) {
				const read = await api.communications.readThread({ thread: ask.thread, view: "recent", limit: 50 });
				if (!stopped && read.ok) setMessages(read.page.messages);
			}
			if (ask.review) {
				const summary = (await api.reviews.read({ review: ask.review, part: "summary", limit: 1 })) as {
					state?: string;
				};
				const found = (await api.reviews.read({ review: ask.review, part: "findings", limit: 50 })) as {
					page?: { rows: ReviewFindingRow[] } | null;
				};
				if (stopped) return;
				setReviewState(summary?.state);
				setFindings(found?.page?.rows ?? []);
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [visible, ask.state, ask.thread, ask.review]);
	const keys = (event: React.KeyboardEvent, submit: () => void) => {
		event.stopPropagation();
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			submit();
		}
		if (event.key === "Escape" && ask.state === "draft") onClose();
	};
	const submitDraft = () => {
		if (draft.trim()) onSend(draft.trim());
	};
	const submitReply = async () => {
		if (!ask.thread || !reply.trim()) return;
		const body = reply.trim();
		setReply("");
		await api.communications.post({ attempt: crypto.randomUUID(), thread: ask.thread, body });
	};
	const operator = OPERATOR;
	return (
		<section
			className="wp-code-ask"
			aria-label={`${action.label.replace("Agents: ", "")}: lines ${ask.start}-${ask.end}`}
		>
			<header>
				<strong>{action.label.replace("Agents: ", "")}</strong>
				<span>
					{ask.path}:{ask.start}-{ask.end}
					{ask.to ? ` \u00b7 ${ask.to}` : ""}
				</span>
				<button type="button" className="wp-icon-button" aria-label="Close thread" onClick={onClose}>
					{"\u00d7"}
				</button>
			</header>
			{ask.state === "draft" || ask.state === "failed" ? (
				<div className="wp-code-ask-compose">
					<textarea
						ref={input}
						aria-label={action.placeholder}
						placeholder={action.placeholder}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => keys(event, submitDraft)}
					/>
					{ask.error && (
						<p role="alert" className="wp-code-ask-error">
							{ask.error}
						</p>
					)}
					<div className="wp-code-ask-actions">
						<button type="button" onClick={onClose}>
							Cancel
						</button>
						<button type="button" className="wp-primary" disabled={!draft.trim()} onClick={submitDraft}>
							{action.send}
						</button>
					</div>
				</div>
			) : ask.state === "sending" ? (
				<p className="wp-code-ask-status">Sending...</p>
			) : (
				<div className="wp-code-ask-thread">
					{ask.review ? (
						<>
							<p className="wp-code-ask-status">
								Review {reviewState ?? "queued"}
								{findings && ` \u00b7 ${findings.length} finding${findings.length === 1 ? "" : "s"}`}
								<button type="button" className="wp-link-button" onClick={onOpenReviews}>
									Open in Reviews
								</button>
							</p>
							<ul className="wp-code-ask-findings">
								{(findings ?? []).map((row) => (
									<li key={`${row.finding.path}:${row.finding.line}:${row.finding.title}`}>
										<button type="button" onClick={() => onReveal(row.finding.line)}>
											<span className={`wp-code-ask-severity is-${row.finding.severity}`}>{row.finding.severity}</span>
											<span>{row.finding.title}</span>
											<small>
												{row.finding.path}:{row.finding.line}
												{row.validation ? ` \u00b7 ${row.validation.disposition}` : ""}
											</small>
										</button>
									</li>
								))}
							</ul>
						</>
					) : (
						<>
							<ol className="wp-code-ask-messages">
								{messages.map((message) => (
									<li key={message.id} className={message.from === operator ? "is-mine" : ""}>
										<strong>{message.from === operator ? "You" : message.fromName}</strong>
										<Markdown text={message.body} />
									</li>
								))}
								{messages.length > 0 && messages.every((message) => message.from === operator) && (
									<li className="wp-code-ask-waiting">Waiting for a reply...</li>
								)}
							</ol>
							<div className="wp-code-ask-compose">
								<textarea
									aria-label="Reply"
									placeholder="Reply"
									value={reply}
									onChange={(event) => setReply(event.target.value)}
									onKeyDown={(event) => keys(event, () => void submitReply())}
								/>
								<div className="wp-code-ask-actions">
									<button
										type="button"
										className="wp-primary"
										disabled={!reply.trim()}
										onClick={() => void submitReply()}
									>
										Reply
									</button>
								</div>
							</div>
						</>
					)}
				</div>
			)}
		</section>
	);
}

export function useCodeAsks({
	instance,
	file,
	world,
	visible,
	onOpenReviews,
}: {
	instance: editor.IStandaloneCodeEditor | undefined;
	file: { root: string; path: string } | undefined;
	world: WorldSnapshot;
	visible: boolean;
	onOpenReviews(): void;
}): ReactNode {
	const [asks, setAsks] = useState<CodeAsk[]>([]);
	const fileRef = useRef(file);
	fileRef.current = file;
	const spacers = useRef(
		new Map<
			string,
			{
				zone?: string;
				dom: HTMLDivElement;
				height: number;
				element?: HTMLElement | null;
				observer?: ResizeObserver;
			}
		>(),
	);
	const worldRef = useRef(world);
	worldRef.current = world;
	const update = useCallback(
		(id: string, change: Partial<CodeAsk>) =>
			setAsks((all) => all.map((ask) => (ask.id === id ? { ...ask, ...change } : ask))),
		[],
	);
	useEffect(() => {
		if (!instance) return;
		const registered: IDisposable[] = ACTIONS.map((action, order) =>
			instance.addAction({
				id: `workplace.agents.${action.kind}`,
				label: action.label,
				contextMenuGroupId: "0_agents",
				contextMenuOrder: order,
				run: (target) => {
					const model = target.getModel();
					const current = fileRef.current;
					if (!model || !current) return;
					const selection = target.getSelection();
					const empty = !selection || selection.isEmpty();
					const ask: CodeAsk = {
						id: crypto.randomUUID(),
						kind: action.kind,
						root: current.root,
						path: current.path,
						start: empty ? 1 : selection.startLineNumber,
						end: empty ? model.getLineCount() : selection.endLineNumber,
						code: empty ? "" : model.getValueInRange(selection),
						language: model.getLanguageId(),
						state: "draft",
					};
					setAsks((all) => [...all, ask]);
				},
			}),
		);
		return () => {
			for (const action of registered) action.dispose();
		};
	}, [instance]);
	const send = useCallback(
		async (ask: CodeAsk, request: string) => {
			const desk = worldRef.current.desk;
			update(ask.id, { state: "sending", error: undefined });
			try {
				if (ask.kind === "review") {
					if (!desk) throw new Error("A review needs a desk person to own it; set up the desk first.");
					const reviewRequest = {
						cwd: ask.root,
						target: { kind: "working-tree" as const, base: "HEAD" },
						paths: [ask.path],
						intent: { text: `${request}\n\nFocus on ${ask.path} lines ${ask.start}-${ask.end}.` },
					};
					const preview = await api.reviews.preview(reviewRequest);
					const summary = await api.reviews.enqueue({
						attempt: crypto.randomUUID(),
						request: reviewRequest,
						expectedDigest: preview.digest,
						owner: desk.person,
					});
					update(ask.id, { state: "sent", review: summary.id, to: summary.ownerName });
					return;
				}
				let to: { id: string; name: string } | null;
				if (ask.kind === "author") {
					to = await api.codeAuthor(`${ask.root}/${ask.path}`);
					if (!to) throw new Error("No agent session has edited this file, so there is no author to ask.");
				} else {
					if (!desk) throw new Error("No desk is set up to receive this.");
					to = { id: desk.person, name: worldRef.current.characters.find((c) => c.id === desk.person)?.name ?? "Desk" };
				}
				const result = await api.communications.sendMail({
					attempt: crypto.randomUUID(),
					to: [to.id],
					subject: subjectOf(ask),
					body: askBody(ask, request),
				});
				const thread = "effect" in result ? result.effect?.thread?.id : undefined;
				if (!thread)
					throw new Error("reason" in result && result.reason ? result.reason : "The message was not delivered.");
				update(ask.id, { state: "sent", thread, to: to.name });
			} catch (error) {
				update(ask.id, { state: "failed", error: (error as Error).message });
			}
		},
		[update],
	);
	const [layer, setLayer] = useState<HTMLDivElement>();
	useEffect(() => {
		if (!instance) return;
		const element = document.createElement("div");
		element.className = "wp-code-ask-layer";
		instance.getContainerDomNode().append(element);
		setLayer(element);
		return () => {
			element.remove();
			setLayer(undefined);
		};
	}, [instance]);
	const current = file ? asks.filter((ask) => ask.root === file.root && ask.path === file.path) : [];
	const currentKey = current.map((ask) => ask.id).join(",");
	const place = useCallback(() => {
		if (!instance) return;
		const layout = instance.getLayoutInfo();
		const origin = instance.getContainerDomNode().getBoundingClientRect().top;
		for (const [, node] of spacers.current) {
			const element = node.element;
			if (!element) continue;
			const hidden = !node.zone || !node.dom.isConnected || node.dom.style.display === "none";
			element.style.display = hidden ? "none" : "";
			if (hidden) continue;
			element.style.top = `${node.dom.getBoundingClientRect().top - origin + 4}px`;
			element.style.left = `${layout.contentLeft}px`;
			element.style.width = `${Math.max(240, layout.contentWidth - layout.verticalScrollbarWidth - 16)}px`;
		}
	}, [instance]);
	useEffect(() => {
		if (!instance) return;
		const shown = new Set(currentKey ? currentKey.split(",") : []);
		instance.changeViewZones((zones) => {
			for (const [id, spacer] of spacers.current) {
				if (spacer.zone) zones.removeZone(spacer.zone);
				spacer.zone = undefined;
				if (!asks.some((ask) => ask.id === id)) spacers.current.delete(id);
			}
			for (const ask of asks) {
				if (!shown.has(ask.id)) continue;
				const spacer = spacers.current.get(ask.id) ?? { height: 160, dom: document.createElement("div") };
				spacers.current.set(ask.id, spacer);
				spacer.zone = zones.addZone({
					afterLineNumber: ask.end,
					heightInPx: spacer.height,
					domNode: spacer.dom,
					onDomNodeTop: () => queueMicrotask(place),
				});
			}
		});
		place();
	}, [instance, currentKey, asks, place]);
	useEffect(() => {
		if (!instance) return;
		const subscriptions = [
			instance.onDidScrollChange(place),
			instance.onDidLayoutChange(place),
			instance.onDidChangeModelContent(place),
		];
		return () => {
			for (const subscription of subscriptions) subscription.dispose();
		};
	}, [instance, place]);
	const measure = (id: string, line: number) => (element: HTMLElement | null) => {
		const spacer = spacers.current.get(id);
		if (!spacer || !instance || spacer.element === element) return;
		spacer.observer?.disconnect();
		spacer.observer = undefined;
		spacer.element = element;
		if (!element) return;
		place();
		const observer = new ResizeObserver(() => {
			const height = Math.ceil(element.getBoundingClientRect().height) + 8;
			if (Math.abs(height - spacer.height) < 2 || !spacer.zone) return;
			spacer.height = height;
			instance.changeViewZones((zones) => {
				if (!spacer.zone) return;
				zones.removeZone(spacer.zone);
				spacer.zone = zones.addZone({
					afterLineNumber: line,
					heightInPx: height,
					domNode: spacer.dom,
					onDomNodeTop: () => queueMicrotask(place),
				});
			});
			place();
		});
		observer.observe(element);
		spacer.observer = observer;
	};
	if (!layer) return null;
	return createPortal(
		current.map((ask) => (
			<div key={ask.id} ref={measure(ask.id, ask.end)} className="wp-code-ask-slot">
				<AskThread
					ask={ask}
					visible={visible}
					onSend={(text) => void send(ask, text)}
					onClose={() => setAsks((all) => all.filter((other) => other.id !== ask.id))}
					onReveal={(line) => {
						instance?.revealLineInCenter(line);
						instance?.setPosition({ lineNumber: line, column: 1 });
						instance?.focus();
					}}
					onOpenReviews={onOpenReviews}
				/>
			</div>
		)),
		layer,
	);
}
