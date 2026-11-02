import { useEffect, useRef, useState } from "react";
import type { CommunicationResult } from "../src/communications.js";
import type { MailItem, MailThreadSummary, WorldSnapshot } from "../src/world.js";
import { Icon } from "./workplace-icon.js";
import { PersonAvatar } from "./workplace-people.js";
import { usePaneResize } from "./workplace-resize.js";
import { ThreadPane } from "./workplace-thread.js";
import "./workplace-mail.css";

const api = window.agentWorld;
let composeAttempt: { id: string; to: string; body: string; result?: CommunicationResult } | undefined;
const ACTIVITY_SEEN = "workplace-mail-activity-seen";

/** Today: the time. This year: day and time. Older: the full date. */
export function when(at: number): string {
	const date = new Date(at);
	const now = new Date();
	const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	if (date.toDateString() === now.toDateString()) return time;
	if (date.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `Yesterday ${time}`;
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
		hour: "numeric",
		minute: "2-digit",
	});
}

export function nameIn(world: WorldSnapshot, id: string): string {
	if (id === "operator") return "You";
	if (id === "harness") return "Pi";
	return (
		world.characters.find((person) => person.id === id)?.name ??
		world.dormant?.find((person) => person.id === id)?.name ??
		id
	);
}

function inboxThreads(world: WorldSnapshot) {
	const channels = new Set(
		world.workplace?.threads.filter((thread) => thread.kind === "channel").map((thread) => thread.id),
	);
	return (world.operatorMail ?? []).filter((thread) => !channels.has(thread.id));
}

/** One message to several people is several delivery records; show it once, with each recipient's state. */
type Letter = { key: string; from: string; fromName: string; body: string; sentAt: number; deliveries: MailItem[] };

function letters(items: MailItem[]): Letter[] {
	const grouped = new Map<string, Letter>();
	for (const item of items) {
		const key = item.id.endsWith(`:${item.to}`) ? item.id.slice(0, -(item.to.length + 1)) : item.id;
		const letter = grouped.get(key) ?? {
			key,
			from: item.from,
			fromName: item.fromName,
			body: item.body,
			sentAt: item.sentAt,
			deliveries: [],
		};
		letter.deliveries.push(item);
		grouped.set(key, letter);
	}
	return [...grouped.values()];
}

const KIND_LABEL: Record<string, string> = { escalation: "Escalation", task: "Task", meeting: "Meeting" };

function Avatar({ id, world }: { id: string; world: WorldSnapshot }) {
	if (id === "harness")
		return (
			<span className="wp-avatar-tile wp-system-avatar" aria-hidden="true">
				pi
			</span>
		);
	return <PersonAvatar id={id} name={nameIn(world, id)} interactive={false} />;
}

function InboxRow({
	world,
	thread,
	selected,
	select,
}: {
	world: WorldSnapshot;
	thread: MailThreadSummary;
	selected: boolean;
	select: () => void;
}) {
	const others = (thread.participants ?? []).filter((id) => id !== "operator");
	const author = thread.lastFrom ?? others[0] ?? "harness";
	const names = others.map((id) => nameIn(world, id));
	return (
		<button
			type="button"
			className={`wp-mail-row${thread.unread ? " wp-unread" : ""}`}
			aria-pressed={selected}
			onClick={select}
		>
			<Avatar id={author} world={world} />
			<span className="wp-mail-row-text">
				<span className="wp-mail-row-top">
					<strong>{names.length ? names.join(", ") : (thread.lastFromName ?? "Pi")}</strong>
					<time dateTime={new Date(thread.lastAt).toISOString()}>{when(thread.lastAt)}</time>
				</span>
				<span className="wp-mail-row-subject">
					{thread.kind && KIND_LABEL[thread.kind] && (
						<span className="wp-mail-kind" data-kind={thread.kind}>
							{KIND_LABEL[thread.kind]}
						</span>
					)}
					{thread.subject}
				</span>
				{thread.preview && (
					<span className="wp-mail-row-preview">
						{thread.lastFromName && thread.lastFrom !== author ? `${thread.lastFromName}: ` : ""}
						{thread.preview.replace(/\s+/g, " ")}
					</span>
				)}
			</span>
			{thread.unread > 0 && (
				<b className="wp-mail-unread" title={`${thread.unread} unread`}>
					{thread.unread}
				</b>
			)}
		</button>
	);
}

function LetterRow({
	world,
	letter,
	selected,
	select,
}: {
	world: WorldSnapshot;
	letter: Letter;
	selected: boolean;
	select: () => void;
}) {
	const recipients = letter.deliveries.map((item) => item.toName);
	const waiting = letter.deliveries.filter((item) => item.state === "waiting").length;
	const failed = letter.deliveries.filter((item) => item.state === "failed").length;
	return (
		<button type="button" className="wp-mail-row" aria-pressed={selected} onClick={select}>
			<Avatar id={letter.from} world={world} />
			<span className="wp-mail-row-text">
				<span className="wp-mail-row-top">
					<strong>
						{letter.fromName} <span className="wp-mail-arrow">→</span> {recipients.join(", ")}
					</strong>
					<time dateTime={new Date(letter.sentAt).toISOString()}>{when(letter.sentAt)}</time>
				</span>
				<span className="wp-mail-row-preview">{letter.body.replace(/\s+/g, " ")}</span>
			</span>
			{(waiting > 0 || failed > 0) && (
				<span className="wp-mail-state" data-state={failed ? "failed" : "waiting"}>
					{failed ? `${failed} failed` : `${waiting} waiting`}
				</span>
			)}
		</button>
	);
}

function LetterReader({ world, letter }: { world: WorldSnapshot; letter: Letter }) {
	return (
		<article className="wp-delivery">
			<header>
				<Avatar id={letter.from} world={world} />
				<div>
					<h1>{letter.fromName}</h1>
					<p>
						{when(letter.sentAt)} · to {letter.deliveries.length} {letter.deliveries.length === 1 ? "person" : "people"}
					</p>
				</div>
				<span className="wp-eyebrow">DELIVERY RECORD</span>
			</header>
			<ul className="wp-delivery-recipients" aria-label="Recipients">
				{letter.deliveries.map((item) => (
					<li key={item.id} data-state={item.state}>
						<Avatar id={item.to} world={world} />
						<span>{item.toName}</span>
						<small>
							{item.state === "delivered" && item.deliveredAt
								? `Delivered ${when(item.deliveredAt)}`
								: item.state === "waiting"
									? "Waiting for them to open"
									: `Failed${item.reason ? `: ${item.reason}` : ""}`}
						</small>
					</li>
				))}
			</ul>
			<div className="wp-delivery-body">{letter.body}</div>
			<p className="wp-muted">A delivery record is what reached each person, not the whole conversation.</p>
		</article>
	);
}

export function Mail({
	world,
	active,
	drafts,
}: {
	world: WorldSnapshot;
	active: boolean;
	drafts: Map<string, string>;
}) {
	const [folder, setFolder] = useState<"inbox" | "sent" | "traffic">("inbox");
	const [selected, setSelected] = useState<string>();
	const [query, setQuery] = useState("");
	const [compose, setCompose] = useState(false);
	const [recipient, setRecipient] = useState("");
	const [delivery, setDelivery] = useState<string>();
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [activitySeen, setActivitySeen] = useState(() => Number(localStorage.getItem(ACTIVITY_SEEN) ?? 0));
	const layout = useRef<HTMLDivElement>(null);
	const list = usePaneResize({
		label: "Mail list width",
		variable: "--wp-mail-list-width",
		axis: "x",
		direction: 1,
		min: 280,
		max: (): number => (list.pane.current?.parentElement?.clientWidth ?? 0) - 380,
	});
	useEffect(() => {
		if (!active || folder !== "traffic") return;
		const now = Date.now();
		localStorage.setItem(ACTIVITY_SEEN, String(now));
		return () => setActivitySeen(now);
	}, [active, folder]);
	const threads = inboxThreads(world);
	const all = world.mail ?? [];
	const sent = letters(all.filter((item) => item.from === "operator"));
	const traffic = letters(all);
	const newActivity = traffic.filter((letter) => letter.sentAt > activitySeen).length;
	const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);
	const needle = query.toLowerCase();
	const matchingThreads = threads.filter(
		(thread) =>
			`${thread.subject} ${thread.preview ?? ""} ${(thread.participants ?? []).map((id) => nameIn(world, id)).join(" ")}`
				.toLowerCase()
				.includes(needle) &&
			(!unreadOnly || thread.unread > 0),
	);
	const shownLetters = (folder === "sent" ? sent : traffic).filter((letter) =>
		`${letter.fromName} ${letter.deliveries.map((item) => item.toName).join(" ")} ${letter.body}`
			.toLowerCase()
			.includes(needle),
	);
	const letter = shownLetters.find((item) => item.key === delivery);
	const thread = threads.find((item) => item.id === selected);
	const folders = [
		["inbox", "Inbox", "inbox", unread],
		["sent", "Sent", "sent", 0],
		["traffic", "Activity", "activity", folder === "traffic" ? 0 : newActivity],
	] as const;
	return (
		<div className="wp-mail-layout wp-mail" ref={layout} style={list.style}>
			<aside className="wp-mail-sidebar">
				<h1>Mail</h1>
				<button type="button" className="wp-compose" onClick={() => setCompose(true)}>
					<Icon name="compose" />
					Compose
				</button>
				<nav aria-label="Mail folders">
					{folders.map(([key, title, icon, count]) => (
						<button
							type="button"
							key={key}
							aria-pressed={folder === key}
							onClick={() => {
								setFolder(key);
								setDelivery(undefined);
							}}
						>
							<Icon name={icon} />
							<span>{title}</span>
							{count > 0 && (
								<b title={key === "traffic" ? `${count} new since you last looked` : `${count} unread`}>{count}</b>
							)}
						</button>
					))}
				</nav>
			</aside>
			<main className="wp-mail-main">
				<section ref={list.ref} className="wp-mail-list" aria-label={folder === "inbox" ? "Inbox" : "Delivery log"}>
					<header className="wp-mail-list-header">
						<div className="wp-mail-list-title">
							<h2>{folder === "inbox" ? "Inbox" : folder === "sent" ? "Sent" : "Activity"}</h2>
							<span>
								{folder === "inbox"
									? `${matchingThreads.length} ${matchingThreads.length === 1 ? "conversation" : "conversations"}`
									: `${shownLetters.length} ${shownLetters.length === 1 ? "message" : "messages"}`}
							</span>
						</div>
						<div className="wp-mail-tools">
							<label className="wp-mail-search">
								<Icon name="search" />
								<input
									aria-label="Search mail"
									placeholder={folder === "inbox" ? "Search people, subjects, text" : "Search messages"}
									value={query}
									onChange={(e) => setQuery(e.target.value)}
								/>
							</label>
							{folder === "inbox" && (
								<button
									type="button"
									className="wp-unread-filter"
									aria-pressed={unreadOnly}
									onClick={() => setUnreadOnly(!unreadOnly)}
								>
									Unread
								</button>
							)}
						</div>
					</header>
					<div className="wp-mail-rows">
						{folder === "inbox"
							? matchingThreads.map((item) => (
									<InboxRow
										key={item.id}
										world={world}
										thread={item}
										selected={selected === item.id}
										select={() => setSelected(item.id)}
									/>
								))
							: shownLetters.map((item) => (
									<LetterRow
										key={item.key}
										world={world}
										letter={item}
										selected={delivery === item.key}
										select={() => setDelivery(item.key)}
									/>
								))}
						{(folder === "inbox" ? !matchingThreads.length : !shownLetters.length) && (
							<p className="wp-list-empty">{query || unreadOnly ? "Nothing matches." : "No mail here yet."}</p>
						)}
					</div>
				</section>
				{list.separator}
				<section className="wp-mail-reader" aria-label="Message reader">
					{folder === "inbox" && selected ? (
						active && (
							<>
								<header className="wp-mail-reader-header">
									<h1>{thread?.subject ?? "Conversation"}</h1>
									<div className="wp-mail-reader-people">
										{(thread?.participants ?? []).map((id) => (
											<span key={id} className="wp-mail-person">
												<Avatar id={id} world={world} />
												{nameIn(world, id)}
											</span>
										))}
										{thread?.kind && KIND_LABEL[thread.kind] && (
											<span className="wp-mail-kind" data-kind={thread.kind}>
												{KIND_LABEL[thread.kind]}
											</span>
										)}
									</div>
								</header>
								<ThreadPane key={selected} id={selected} world={world} drafts={drafts} embedded />
							</>
						)
					) : letter && folder !== "inbox" ? (
						<LetterReader world={world} letter={letter} />
					) : (
						<div className="wp-empty">
							<span className="wp-empty-icon">
								<Icon name="mail" />
							</span>
							<h1>{folder === "inbox" ? "Pick a conversation" : "Pick a message"}</h1>
							<p>
								{folder === "inbox" ? "Replies go to everyone in the conversation." : "See who it reached, and when."}
							</p>
						</div>
					)}
				</section>
			</main>
			{compose && (
				<Compose
					world={world}
					drafts={drafts}
					recipient={recipient}
					setRecipient={setRecipient}
					close={() => setCompose(false)}
				/>
			)}
		</div>
	);
}

function Compose({
	world,
	drafts,
	close,
	recipient,
	setRecipient,
}: {
	world: WorldSnapshot;
	drafts: Map<string, string>;
	close: () => void;
	recipient: string;
	setRecipient: (id: string) => void;
}) {
	const people = [...world.characters, ...(world.dormant ?? []).filter((person) => !person.retiredAt)];
	const [attempt, setAttempt] = useState(composeAttempt);
	const to = attempt?.to ?? (recipient || people[0]?.id || "");
	const [body, setBody] = useState(drafts.get("compose") ?? "");
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState(composeAttempt ? "Saved mail attempt; check its original outcome." : "");
	const [sent, setSent] = useState(composeAttempt?.result?.outcome === "applied");
	const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const unresolved = !!attempt && !["applied", "refused"].includes(attempt.result?.outcome ?? "pending");
	const locked = pending || sent || unresolved;
	const reflect = (result: CommunicationResult, entry: NonNullable<typeof composeAttempt>) => {
		entry.result = result;
		composeAttempt = entry;
		if (result.outcome === "applied" && drafts.get("compose") === entry.body) drafts.delete("compose");
		if (!mounted.current) return;
		setAttempt({ ...entry });
		if (result.outcome === "applied") {
			setSent(true);
			const audience = result.effect?.audience ?? result.effect?.to;
			const names = (ids: string[]) =>
				ids.map((id) => people.find((person) => person.id === id)?.name ?? id).join(", ");
			setStatus(
				`Sent${audience ? ` to ${names(audience)}` : ""}.${result.effect?.queued?.length ? ` ${names(result.effect.queued)} will get it when they come back.` : ""}`,
			);
		} else setStatus(result.reason ?? `Mail ${result.outcome}. Check this attempt before sending again.`);
	};
	const send = async () => {
		if (
			locked ||
			!to ||
			!body.trim() ||
			(composeAttempt && !["applied", "refused"].includes(composeAttempt.result?.outcome ?? "pending"))
		)
			return;
		const entry = { id: crypto.randomUUID(), to, body };
		composeAttempt = entry;
		setAttempt(entry);
		setPending(true);
		setStatus("");
		try {
			reflect(
				await api.communications.sendMail({ attempt: entry.id, to: [to], subject: "Message from the operator", body }),
				entry,
			);
		} catch (failure) {
			reflect({ attempt: entry.id, outcome: "uncertain", reason: `Mail outcome uncertain: ${String(failure)}` }, entry);
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const recover = async () => {
		if (!attempt || pending) return;
		setPending(true);
		try {
			reflect(await api.communications.status({ attempt: attempt.id }), attempt);
		} catch (failure) {
			if (mounted.current) setStatus(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const dismiss = () => {
		if (!unresolved) composeAttempt = undefined;
		close();
	};
	return (
		<section className="wp-compose-window" role="dialog" aria-label="New message">
			<header>
				<strong>New message</strong>
				<button type="button" disabled={pending} onClick={dismiss} aria-label="Close new message">
					<Icon name="close" />
				</button>
			</header>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<label className="wp-compose-to">
					<span>To</span>
					<select
						aria-label="Mail recipient"
						value={to}
						disabled={locked}
						onChange={(e) => {
							setRecipient(e.target.value);
							setAttempt(undefined);
							composeAttempt = undefined;
						}}
					>
						{people.map((person) => (
							<option key={person.id} value={person.id}>
								{person.name}
							</option>
						))}
					</select>
				</label>
				<textarea
					aria-label="Mail body"
					placeholder="Write a message…"
					value={body}
					disabled={locked}
					onChange={(e) => {
						setBody(e.target.value);
						drafts.set("compose", e.target.value);
					}}
				/>
				{status && <p role="status">{status}</p>}
				{attempt && attempt.result?.outcome !== "applied" && (
					<p className="wp-thread-attempt">
						Mail attempt: {attempt.id} · {attempt.result?.outcome ?? "pending"}{" "}
						<button type="button" disabled={pending} onClick={() => void recover()}>
							Check mail outcome
						</button>
					</p>
				)}
				{attempt?.result?.outcome === "not_recorded" && (
					<div className="wp-communication-restart">
						<p>
							No durable record was found. A disconnected original send could still arrive; a fresh send may duplicate
							it.
						</p>
						<label>
							<input
								type="checkbox"
								checked={acknowledgeDuplicate}
								onChange={(event) => setAcknowledgeDuplicate(event.target.checked)}
							/>
							I understand a fresh attempt may duplicate the original.
						</label>
						<button
							type="button"
							disabled={pending || !acknowledgeDuplicate}
							onClick={() => {
								composeAttempt = undefined;
								setAttempt(undefined);
								setAcknowledgeDuplicate(false);
								setStatus("Draft retained. A new send will use a fresh attempt.");
							}}
						>
							Keep draft and prepare a new mail attempt
						</button>
					</div>
				)}
				<footer>
					<span className="wp-muted">Durable mail, signed as you. People who are away get it when they come back.</span>
					<button type="submit" className="wp-primary" disabled={locked || !to || !body.trim()}>
						{pending ? "Sending…" : sent ? "Sent" : "Send mail"}
					</button>
				</footer>
			</form>
		</section>
	);
}
