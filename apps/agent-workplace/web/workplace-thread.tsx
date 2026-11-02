import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConversationReadOptions } from "../../../components/session-state/src/communication-types.js";
import type {
	CommunicationResult,
	ConversationInfo,
	ConversationMessage,
	ConversationPage,
	MessageSearchResult,
} from "../src/communications.js";
import type { WorkplaceThread, WorldSnapshot } from "../src/world.js";
import { FileReferenceCwd, FileReferenceText } from "./file-references.js";
import { ReplyingTo } from "./overlay/conversation/actions.js";
import { type QuotedMessage, withQuote } from "./overlay/conversation/quote.js";
import { Markdown } from "./overlay/conversation/transcript.js";
import { useWindowFocus } from "./use-window-focus.js";
import { commandHints, runCommand } from "./workplace-commands.js";
import { CommunicationDialog, CommunicationRecipients } from "./workplace-communications.js";
import { Icon } from "./workplace-icon.js";
import { useMentions } from "./workplace-mentions.js";
import { ActionableMessage } from "./workplace-message-actions.js";
import { PersonAvatar, PersonName } from "./workplace-people.js";
import type { SwitchTarget } from "./workplace-switcher.js";

const api = window.agentWorkplace;
const attempts = new Map<string, { id: string; label: string; body?: string; result?: CommunicationResult }>();
const notificationDrafts = new Map<string, string[]>();

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyed reader keeps paging, active-following, mutation recovery and draft ownership in one lifecycle
export function ThreadPane({
	id,
	channel,
	channelLabel,
	world,
	drafts,
	listener,
	embedded,
	toolbarHost,
}: {
	id: string;
	channel?: Pick<WorkplaceThread, "lastSeq">;
	channelLabel?: string;
	world: WorldSnapshot;
	drafts: Map<string, string>;
	/** A person every channel post notifies, such as the front desk's coordinator. */
	listener?: string;
	/** Hosted in a pane that already names the conversation: no title or participant line of its own. */
	embedded?: boolean;
	/** The host pane's header slot for the reading controls (search, Catch up, Read latest, Actions). */
	toolbarHost?: HTMLElement | null;
}) {
	const hosted = (tools: ReactNode) => (toolbarHost ? createPortal(tools, toolbarHost) : tools);
	const head = id.startsWith("team:") ? id.slice("team:".length) : undefined;
	const headName = head
		? (world.characters.find((person) => person.id === head)?.name ??
			world.dormant?.find((person) => person.id === head)?.name)
		: undefined;
	const place = listener ? "the front desk" : headName ? `${headName}'s team` : `#${channelLabel ?? id}`;
	const [searching, setSearching] = useState(false);
	const [page, setPage] = useState<ConversationPage>();
	const [unreadAfter, setUnreadAfter] = useState<number>();
	const [draft, setDraft] = useState(drafts.get(id) ?? "");
	const [replyTo, setReplyTo] = useState<QuotedMessage>();
	const composer = useRef<HTMLTextAreaElement>(null);
	const mentions = useMentions(world, composer, draft, (value) => {
		setDraft(value);
		drafts.set(id, value);
	});
	const [notify, changeNotify] = useState<string[]>(notificationDrafts.get(id) ?? []);
	const setNotify = (people: string[]) => {
		changeNotify(people);
		notificationDrafts.set(id, people);
	};
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
	const [attempt, setAttempt] = useState(attempts.get(id));
	const [view, setView] = useState<"catch_up" | "recent" | "range">("recent");
	const [limit, setLimit] = useState(50);
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState<MessageSearchResult>();
	const [dialog, setDialog] = useState<"invite" | "remove" | "archive" | "reopen">();
	const [people, setPeople] = useState<string[]>([]);
	const [reason, setReason] = useState("");
	const mounted = useRef(true);
	const messages = useRef<HTMLDivElement>(null);
	const actionsMenu = useRef<HTMLDetailsElement>(null);
	const followLatest = useRef(!!channel);
	const attemptedSeq = useRef(0);
	const focused = useWindowFocus();
	const readOptions = useRef<ConversationReadOptions | undefined>(undefined);
	const searchOptions = useRef<{ query: string; limit: number } | undefined>(undefined);
	const thread = page?.thread;
	const unresolved = !!attempt && !["applied", "refused"].includes(attempt.result?.outcome ?? "pending");
	const locked = pending || unresolved;
	const latestSeq = page?.window_through ?? 0;
	const hasNew = !!channel && channel.lastSeq > latestSeq;
	useLayoutEffect(() => {
		if (page && followLatest.current && messages.current) messages.current.scrollTop = messages.current.scrollHeight;
	}, [page]);
	const read = useCallback(async (options: ConversationReadOptions, append = false) => {
		if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
			setError("Choose a positive whole-number page size.");
			return;
		}
		const entry =
			options.view === "catch_up"
				? ({ id: crypto.randomUUID(), label: "Catch up" } as NonNullable<ReturnType<typeof attempts.get>>)
				: undefined;
		if (entry) {
			attempts.set(options.thread, entry);
			setAttempt(entry);
		}
		setPending(true);
		setError("");
		try {
			const result = await api.communications.readThread({ ...options, ...(entry ? { attempt: entry.id } : {}) });
			if (entry) {
				if (result.ok && !["failed", "uncertain"].includes(result.page.acknowledgment)) {
					attempts.delete(options.thread);
					if (mounted.current) setAttempt(undefined);
				} else {
					entry.result = {
						attempt: entry.id,
						outcome: "uncertain",
						reason: result.ok
							? (result.page.acknowledgment_reason ?? "Catch-up acknowledgment not confirmed.")
							: result.reason,
					};
					if (mounted.current) setAttempt({ ...entry });
				}
			}
			if (!mounted.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			const returned = result.page;
			if (returned.thread.kind === "channel" && returned.thread.following)
				setUnreadAfter((previous) => previous ?? returned.thread.read_up_to);
			readOptions.current = { ...options, view: returned.view };
			setPage((previous) =>
				append && previous
					? {
							...returned,
							messages: [
								...new Map(
									[...previous.messages, ...returned.messages].map((message) => [message.seq, message]),
								).values(),
							].sort((a, b) => a.seq - b.seq),
						}
					: returned,
			);
			setView(returned.view);
			setSearch(undefined);
			if (returned.acknowledgment === "failed" || returned.acknowledgment === "uncertain")
				setError(
					`Catch-up acknowledgment ${returned.acknowledgment}: ${returned.acknowledgment_reason ?? "Read position was not confirmed."} Last confirmed sequence: ${returned.last_confirmed_cursor}.`,
				);
		} catch (failure) {
			if (entry) entry.result = { attempt: entry.id, outcome: "uncertain", reason: String(failure) };
			if (mounted.current) {
				if (entry) setAttempt({ ...entry });
				setError(String(failure));
			}
		} finally {
			if (mounted.current) setPending(false);
		}
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed opening inspects once; explicit and focused reads own subsequent requests
	useEffect(() => {
		mounted.current = true;
		void read({ thread: id, view: "recent", limit });
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		if (
			!thread?.access ||
			!hasNew ||
			locked ||
			!focused ||
			!followLatest.current ||
			attemptedSeq.current >= (channel?.lastSeq ?? 0) ||
			search
		)
			return;
		attemptedSeq.current = channel!.lastSeq;
		void read({ thread: id, view: "recent", limit });
	}, [thread, hasNew, locked, focused, channel, search, read, id, limit]);
	const describe = (result: CommunicationResult) => {
		if (result.outcome !== "applied") return result.reason ?? `Operation ${result.outcome}; no new attempt was sent.`;
		const effect = result.effect;
		const names = (ids: string[]) =>
			ids
				.map((person) =>
					person === "operator"
						? "You"
						: (world.characters.find((item) => item.id === person)?.name ??
							world.dormant?.find((item) => item.id === person)?.name ??
							thread?.invitations?.find((item) => item.id === person)?.name ??
							thread?.participants.find((item) => item.id === person)?.name ??
							person),
				)
				.join(", ");
		const details = effect?.people
			?.map(
				(person) =>
					`${names([person.person])}: ${person.explicit_invitation_removed ? "explicit invitation removed" : person.membership_removed ? "membership removed" : person.explicit_invitation_added || person.membership_added ? "invited" : "no invitation change"}; ${person.access ? "still has access" : "no access"}${person.following === null ? "" : person.following ? "; following" : "; not following"}`,
			)
			.join(". ");
		return [
			"Applied.",
			effect?.notify
				? effect.notify.length
					? `Notified: ${names(effect.notify)}.`
					: "Quiet post; nobody notified."
				: "",
			effect?.audience ? `Addressed audience: ${names(effect.audience)}.` : "",
			effect?.queued?.length ? `Queued for a later opening: ${names(effect.queued)}.` : "",
			details,
		]
			.filter(Boolean)
			.join(" ");
	};
	const accept = async (result: CommunicationResult, body?: string) => {
		if (result.outcome === "applied" && body !== undefined && drafts.get(id) === body) drafts.delete(id);
		if (!mounted.current) return;
		setNote(listener && body !== undefined && result.outcome === "applied" ? "" : describe(result));
		if (result.outcome === "refused") setError(result.reason ?? "Operation refused.");
		if (result.outcome !== "applied" || !result.effect) return;
		if (body !== undefined) {
			setDraft("");
			setNotify([]);
		}
		setPage((previous) => (previous ? { ...previous, thread: result.effect!.thread } : previous));
		if (result.effect.thread.following === false) setUnreadAfter(undefined);
		setDialog(undefined);
		setReason("");
		setPeople([]);
		if (result.effect.page) {
			setPage(result.effect.page);
			setView(result.effect.page.view);
			const operation = result.command?.operation;
			readOptions.current =
				operation?.action === "read" ? operation : { thread: id, view: result.effect.page.view, limit };
		} else if (result.effect.thread.access) await read({ thread: id, view: "recent", limit });
	};
	const run = async (label: string, action: (attempt: string) => Promise<CommunicationResult>, body?: string) => {
		if (
			locked ||
			(attempts.has(id) && !["applied", "refused"].includes(attempts.get(id)?.result?.outcome ?? "pending"))
		)
			return;
		actionsMenu.current?.removeAttribute("open");
		const entry = { id: crypto.randomUUID(), label, body } as NonNullable<ReturnType<typeof attempts.get>>;
		attempts.set(id, entry);
		setAttempt(entry);
		setPending(true);
		setError("");
		setNote("");
		try {
			entry.result = await action(entry.id);
			if (mounted.current) setAttempt({ ...entry });
			await accept(entry.result, body);
		} catch (failure) {
			if (mounted.current)
				setError(`${label} outcome uncertain: ${String(failure)}. Check the saved attempt before submitting again.`);
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const recover = async () => {
		if (!attempt) return;
		setPending(true);
		setError("");
		try {
			const result = await api.communications.status({ attempt: attempt.id });
			const entry = { ...attempt, result };
			attempts.set(id, entry);
			if (!mounted.current) return;
			setAttempt(entry);
			await accept(result, attempt.body);
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const find = async (cursor?: string) => {
		if (!query.trim() || pending) return;
		setPending(true);
		setError("");
		followLatest.current = false;
		try {
			const selected = cursor && searchOptions.current ? searchOptions.current : { query: query.trim(), limit };
			const result = await api.communications.searchMessages({ ...selected, thread: id, cursor });
			if (!mounted.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			searchOptions.current = selected;
			setSearch((previous) =>
				cursor && previous
					? { ...result.value, messages: [...previous.messages, ...result.value.messages] }
					: result.value,
			);
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setPending(false);
		}
	};
	const followLink = async (author: string, href: string, file: boolean) => {
		try {
			const cwd =
				world.characters.find((person) => person.id === author)?.facts?.cwd ??
				world.dormant?.find((person) => person.id === author)?.cwd;
			const result = file ? await api.openFile?.(href, cwd ?? "") : await api.openLink?.(href);
			if (mounted.current && !result?.ok) setError(result?.reason ?? "This window cannot open links.");
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		}
	};
	const send = () => {
		if (locked || !thread?.permissions.post || !draft.trim()) return;
		if (channel && draft.trimStart().startsWith("/")) {
			const typed = draft;
			void runCommand(world, typed).then((result) => {
				if (!result) return post(typed);
				if (!mounted.current) return;
				setNote(result.note);
				if (result.ok && drafts.get(id) === typed) {
					setDraft("");
					drafts.set(id, "");
				}
			});
			return;
		}
		post(draft);
	};
	const post = (words: string) => {
		const draft = words;
		const body = withQuote(draft, replyTo);
		const mentioned = mentions.mentioned(draft);
		setReplyTo(undefined);
		mentions.reset();
		void run(
			channel ? "Post" : "Reply",
			(attempt) =>
				api.communications.post({
					attempt,
					thread: id,
					body,
					...(channel ? { notify: [...new Set([...(listener ? [listener] : []), ...notify, ...mentioned])] } : {}),
				}),
			body,
		);
	};
	const submitDialog = () => {
		if (!dialog) return;
		if (dialog === "invite" || dialog === "remove") {
			if (!people.length) return;
			void run(dialog === "invite" ? "Invite" : "Remove invitation", (attempt) =>
				dialog === "invite"
					? api.communications.invite({ attempt, thread: id, people })
					: api.communications.removeInvitations({ attempt, thread: id, people }),
			);
		} else if (reason.trim()) {
			void run(dialog === "archive" ? "Archive" : "Reopen", (attempt) =>
				dialog === "archive"
					? api.communications.archive({ attempt, thread: id, summary: reason.trim(), ...(channel ? { notify } : {}) })
					: api.communications.reopen({ attempt, thread: id, reason: reason.trim(), ...(channel ? { notify } : {}) }),
			);
		}
	};
	const openAction = (action: typeof dialog) => {
		actionsMenu.current?.removeAttribute("open");
		setDialog(action);
		setReason("");
		setPeople([]);
		setError("");
	};
	return (
		<article
			className={`wp-thread${channel ? " wp-thread-channel" : ""}${embedded ? " is-embedded" : ""}${listener ? " wp-thread-desk" : ""}`}
		>
			<header className="wp-thread-header">
				{!channel && !embedded && <h1>{thread?.name ?? "Reading conversation..."}</h1>}
				{!toolbarHost && (
					<p>
						{!embedded &&
							thread?.participants.map((person, index) => (
								<span key={person.id}>
									<PersonName id={person.id} name={displayName(person.id, person.name)} />
									{index < thread.participants.length - 1 && ","}
								</span>
							))}
					</p>
				)}
				{hosted(
					<>
						<button
							type="button"
							className="wp-thread-search-toggle"
							aria-label="Search this conversation"
							title="Search this conversation, or change the page size"
							aria-pressed={searching}
							onClick={() => {
								setSearching(!searching);
								if (searching) setSearch(undefined);
							}}
						>
							<Icon name="search" />
						</button>
						{thread && (!channel || thread.following) && (
							<button
								type="button"
								disabled={locked || !Number.isSafeInteger(limit) || limit < 1}
								onClick={() => {
									followLatest.current = false;
									void read({ thread: id, view: "catch_up", limit });
								}}
							>
								Catch up
							</button>
						)}
						<button
							type="button"
							disabled={pending}
							onClick={() => {
								followLatest.current = !!channel;
								void read({ thread: id, view: "recent", limit });
							}}
						>
							Read latest
						</button>
						{thread && (
							<details ref={actionsMenu} className="wp-channel-menu">
								<summary aria-label="Conversation actions">Actions</summary>
								<div>
									{channel &&
										(thread.following ? (
											<button
												type="button"
												disabled={locked}
												onClick={() =>
													void run("Leave channel", (attempt) => api.communications.leave({ attempt, thread: id }))
												}
											>
												Leave channel
											</button>
										) : (
											thread.permissions.join && (
												<button
													type="button"
													disabled={locked}
													onClick={() =>
														void run("Join channel", (attempt) => api.communications.join({ attempt, thread: id }))
													}
												>
													Join channel
												</button>
											)
										))}
									{thread.permissions.invite && (
										<button type="button" disabled={locked} onClick={() => openAction("invite")}>
											Invite people
										</button>
									)}
									{thread.permissions.remove && (
										<button type="button" disabled={locked} onClick={() => openAction("remove")}>
											Remove invitations
										</button>
									)}
									{!channel && thread.kind !== "task" && (
										<button
											type="button"
											disabled={locked}
											onClick={() =>
												void run("Leave conversation", (attempt) => api.communications.leave({ attempt, thread: id }))
											}
										>
											Leave conversation
										</button>
									)}
									{thread.permissions.archive && (
										<button type="button" disabled={locked} onClick={() => openAction("archive")}>
											Archive conversation
										</button>
									)}
									{thread.permissions.reopen && (
										<button type="button" disabled={locked} onClick={() => openAction("reopen")}>
											Reopen conversation
										</button>
									)}
								</div>
							</details>
						)}
					</>,
				)}
				{hasNew && (
					<button
						type="button"
						className="wp-new-posts"
						disabled={pending}
						onClick={() => {
							followLatest.current = true;
							void read({ thread: id, view: "recent", limit });
						}}
					>
						New messages - jump to latest
					</button>
				)}
			</header>
			{thread?.purpose && !listener && <p className="wp-thread-note">{thread.purpose}</p>}
			{thread?.pinned && (
				<div className="wp-channel-pin">
					Current context:{" "}
					<button
						type="button"
						disabled={pending}
						onClick={() => {
							followLatest.current = false;
							void read({
								thread: id,
								view: "range",
								after: thread.pinned!.seq - 1,
								through: thread.pinned!.seq,
								limit,
							});
						}}
					>
						Message #{thread.pinned.seq}
					</button>{" "}
					· authored context, not an automatic summary
				</div>
			)}
			<form
				className="wp-channel-recall"
				hidden={!searching}
				onSubmit={(event) => {
					event.preventDefault();
					void find();
				}}
			>
				<input
					aria-label="Search conversation"
					placeholder="Search messages"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<button type="submit" disabled={pending || !query.trim()}>
					Search
				</button>
				<label>
					Page size{" "}
					<input
						aria-label="Message page size"
						type="number"
						min="1"
						step="1"
						value={limit}
						onChange={(event) => setLimit(Number(event.target.value))}
					/>
				</label>
			</form>
			<div
				className="wp-thread-messages"
				ref={messages}
				onScroll={() => {
					const el = messages.current;
					if (el) followLatest.current = el.scrollHeight - el.clientHeight - el.scrollTop < 24;
				}}
			>
				{!page && pending && <p role="status">Reading conversation...</p>}
				{!listener && page && !page.messages.length && !search && <p className="wp-thread-empty">No messages yet.</p>}
				{listener && page && !page.messages.length && !search && (
					<div className="wp-desk-welcome">
						<h2>Tell the organization what you need</h2>
						<p>
							Write here as you would to a chief of staff. The coordinator turns it into owned work, answers in a few
							lines, and tells you when something needs you.
						</p>
						<ul>
							<li>"Bring GitHub PR review comments into the organization."</li>
							<li>"What is everyone working on, and what is stuck?"</li>
							<li>"Have someone reproduce the flaky /org experience test."</li>
						</ul>
					</div>
				)}
				{search && <p role="status">Search results are inspection only; catch-up is unchanged.</p>}
				{page && (
					<ThreadMessages
						world={world}
						thread={page.thread}
						messages={search?.messages ?? page.messages}
						channel={!!channel}
						unreadAfter={channel ? unreadAfter : undefined}
						followLink={(author, href, file) => void followLink(author, href, file)}
						where={channel ? place : (page.thread.name ?? undefined)}
						origin={
							channel ? { kind: "channel", id } : { kind: "thread", id, title: page.thread.name ?? "Conversation" }
						}
						reply={
							!locked && page.thread.permissions.post && !page.thread.archived
								? (message) => {
										setReplyTo(message);
										composer.current?.focus();
									}
								: undefined
						}
						canPin={!locked && page.thread.permissions.pin}
						pin={(seq) =>
							void run("Pin current context", (attempt) => api.communications.pin({ attempt, thread: id, seq }))
						}
					/>
				)}
				{search?.next_cursor ? (
					<button type="button" disabled={pending} onClick={() => void find(search.next_cursor)}>
						More search results
					</button>
				) : (
					!search &&
					page?.next_cursor && (
						<button
							type="button"
							disabled={pending || (view === "catch_up" && unresolved)}
							onClick={() => {
								followLatest.current = false;
								void read({ ...(readOptions.current ?? { thread: id, view, limit }), cursor: page.next_cursor }, true);
							}}
						>
							{view === "recent" ? "Earlier messages" : "Next message page"}
						</button>
					)
				)}
				{error && <p role="alert">{error}</p>}
				{note && <p role="status">{note}</p>}
				{attempt?.result?.outcome === "not_recorded" && (
					<div className="wp-communication-restart">
						<p>No durable record was found. The original request could still arrive; a new attempt may duplicate it.</p>
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
								attempts.delete(id);
								setAttempt(undefined);
								setAcknowledgeDuplicate(false);
								setNote(
									`Previous attempt ${attempt.id} was not recorded. You chose to prepare a new attempt; the draft is retained.`,
								);
							}}
						>
							Keep draft and prepare a new attempt
						</button>
					</div>
				)}
				{attempt && attempt.result?.outcome !== "applied" && (
					<p className="wp-thread-attempt">
						{attempt.label} attempt: {attempt.id} · {attempt.result?.outcome ?? "uncertain"}{" "}
						<button type="button" disabled={pending} onClick={() => void recover()}>
							Check outcome
						</button>
					</p>
				)}
			</div>
			{thread?.archived ? (
				<p className="wp-thread-note">
					Archived conversation. Authorized participants can reopen it; history remains readable.
				</p>
			) : (
				thread?.permissions.post && (
					<form
						className="wp-thread-compose"
						onSubmit={(event) => {
							event.preventDefault();
							send();
						}}
					>
						{replyTo && <ReplyingTo message={replyTo} clear={() => setReplyTo(undefined)} />}
						{channel && !listener && (
							<details className="wp-thread-notify">
								<summary>
									{notify.length ? `Notify ${notify.length} selected people` : "Notify: nobody (quiet post)"}
								</summary>
								<CommunicationRecipients
									world={world}
									label="Notify"
									value={notify}
									onChange={setNotify}
									disabled={locked}
								/>
								<p>
									Only selected and @mentioned people receive attention; other names in prose are just text. Recipients
									must already have access.
								</p>
							</details>
						)}
						{channel && mentions.list}
						{channel && commandHints(draft).length > 0 && (
							<ul className="wp-mentions" aria-label="Commands">
								{commandHints(draft).map((command) => (
									<li key={command.name}>
										<button
											type="button"
											tabIndex={-1}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => {
												setDraft(`/${command.name} @`);
												drafts.set(id, `/${command.name} @`);
												composer.current?.focus();
											}}
										>
											<strong>{command.usage}</strong>
											<small>{command.help}</small>
										</button>
									</li>
								))}
							</ul>
						)}
						<label>
							<span className="wp-visually-hidden">
								{channel ? "Post to channel as operator" : "Reply to everyone"}
							</span>
							<textarea
								ref={composer}
								aria-label={channel ? "Post to channel" : "Reply to everyone"}
								placeholder={
									listener
										? "Tell the organization what you need..."
										: channel
											? "Write to this channel..."
											: "Write your reply..."
								}
								value={draft}
								disabled={locked}
								onChange={(event) => {
									setDraft(event.target.value);
									drafts.set(id, event.target.value);
									if (channel) mentions.track(event.target.value, event.target.selectionStart);
								}}
								onKeyDown={(event) => {
									if (channel && mentions.onKeyDown(event)) return;
									const hint = channel && event.key === "Tab" ? commandHints(draft)[0] : undefined;
									if (hint) {
										event.preventDefault();
										setDraft(`/${hint.name} @`);
										drafts.set(id, `/${hint.name} @`);
										mentions.track(`/${hint.name} @`, hint.name.length + 3);
										return;
									}
									if (
										event.key === "Enter" &&
										!event.nativeEvent.isComposing &&
										(event.metaKey || event.ctrlKey || (channel && !event.shiftKey))
									) {
										event.preventDefault();
										send();
									}
								}}
							/>
						</label>
						<div className="wp-compose-footer">
							<span>
								{channel ? (
									<>
										<kbd>Enter</kbd> posts &middot; <kbd>Shift</kbd>+<kbd>Enter</kbd> new line &middot; <kbd>@</kbd>{" "}
										mentions &middot; <kbd>/</kbd> commands
									</>
								) : (
									<>
										<kbd>{"\u2318"}</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> replies
									</>
								)}
							</span>
							<button type="submit" className="wp-primary" disabled={locked || !draft.trim()}>
								{channel ? "Post message" : "Send reply"}
							</button>
						</div>
					</form>
				)
			)}
			{channel && thread && !thread.following && (
				<div className="wp-channel-preview">
					<p>
						You are viewing <strong>{place}</strong>. Join to see its new posts in your unread counts.
					</p>
					{thread.permissions.join && (
						<button
							type="button"
							className="wp-primary"
							disabled={locked}
							onClick={() => void run("Join channel", (attempt) => api.communications.join({ attempt, thread: id }))}
						>
							Join channel
						</button>
					)}
				</div>
			)}
			{dialog && (
				<CommunicationDialog
					title={
						dialog === "invite"
							? "Invite people"
							: dialog === "remove"
								? "Remove explicit invitations"
								: dialog === "archive"
									? "Archive conversation"
									: "Reopen conversation"
					}
					busy={pending}
					close={() => setDialog(undefined)}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							submitDialog();
						}}
					>
						{dialog === "invite" || dialog === "remove" ? (
							<>
								<p>
									{dialog === "invite"
										? "Invitees gain access to retained history. Invitations change no reporting lines or assignments and launch nobody."
										: "Remove explicit grants or mail members. Organization-derived channel access may remain; this does not make a person leave their organization."}
								</p>
								<CommunicationRecipients
									world={world}
									label={dialog === "invite" ? "Invite" : "Remove invitation"}
									candidates={
										dialog === "remove"
											? (channel ? (thread?.invitations ?? []) : (thread?.participants ?? [])).filter(
													(person) => person.id !== "operator",
												)
											: undefined
									}
									value={people}
									onChange={setPeople}
									disabled={locked}
								/>
							</>
						) : (
							<>
								<p>
									{dialog === "archive"
										? "Publish a conclusion and archive together. This records your conclusion, not consensus or completed work."
										: "Record a reason and reopen this discussion. This restores neither actors nor assignments."}
								</p>
								<label>
									{dialog === "archive" ? "Conclusion" : "Reopening reason"}
									<textarea
										required
										value={reason}
										disabled={locked}
										onChange={(event) => setReason(event.target.value)}
									/>
								</label>
								{channel && (
									<CommunicationRecipients
										world={world}
										label="Notify"
										value={notify}
										onChange={setNotify}
										disabled={locked}
									/>
								)}
							</>
						)}
						{error && <p role="alert">{error}</p>}
						{unresolved && (
							<p>Outcome uncertain. Close this dialog and check the saved attempt before another action.</p>
						)}
						<footer>
							<button type="button" disabled={pending} onClick={() => setDialog(undefined)}>
								Cancel
							</button>
							<button
								type="submit"
								disabled={locked || (dialog === "invite" || dialog === "remove" ? !people.length : !reason.trim())}
							>
								Confirm {dialog}
							</button>
						</footer>
					</form>
				</CommunicationDialog>
			)}
		</article>
	);
}

function ThreadMessages({
	world,
	thread,
	messages,
	channel,
	canPin,
	pin,
	unreadAfter,
	followLink,
	where,
	reply,
	origin,
}: {
	world: WorldSnapshot;
	thread: ConversationInfo;
	messages: ConversationMessage[];
	channel: boolean;
	origin: SwitchTarget;
	where?: string;
	reply?: (message: QuotedMessage) => void;
	canPin: boolean;
	pin: (seq: number) => void;
	unreadAfter?: number;
	followLink: (author: string, href: string, file: boolean) => void;
}) {
	const firstUnread =
		unreadAfter === undefined
			? undefined
			: messages.find((message) => message.seq > unreadAfter && message.from !== "operator")?.seq;
	return messages.map((message, index) => {
		const previous = messages[index - 1];
		const newDay = !previous || dayOf(previous.at) !== dayOf(message.at);
		const continued =
			!newDay && previous?.from === message.from && message.at - previous.at < GROUP_MS && message.seq !== firstUnread;
		return (
			<Fragment key={message.id}>
				{newDay && (
					<div className="wp-day-divider">
						<span>{dayLabel(message.at)}</span>
					</div>
				)}
				{message.seq === firstUnread && (
					<div className="wp-unread-divider">
						<span aria-hidden="true">New messages</span>
						<hr aria-label="New messages" />
					</div>
				)}
				<ActionableMessage
					className={`wp-message${continued ? " is-continued" : ""}`}
					id={`message-${message.seq}`}
					message={{
						author: displayName(message.from, message.fromName),
						at: message.at,
						text: message.body,
						where,
					}}
					onReply={reply}
					origin={origin}
					extra={[
						{
							label: "Copy reference",
							onSelect: () => void navigator.clipboard.writeText(`${thread.id}#${message.seq}`),
						},
						...(canPin ? [{ label: "Pin as current context", onSelect: () => pin(message.seq) }] : []),
					]}
				>
					{message.from === "harness" ? (
						<span className="wp-avatar-tile wp-message-avatar wp-system-avatar" aria-hidden="true">
							pi
						</span>
					) : (
						<PersonAvatar
							id={message.from}
							name={displayName(message.from, message.fromName)}
							className="wp-message-avatar"
						/>
					)}
					<div className="wp-message-content">
						<header>
							<strong>
								<PersonName id={message.from} name={displayName(message.from, message.fromName)} />
							</strong>
							<time
								dateTime={new Date(message.at).toISOString()}
								title={`${new Date(message.at).toLocaleString()} \u00b7 #${message.seq}`}
							>
								{new Date(message.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
							</time>
						</header>
						<div className="wp-message-body">
							<FileReferenceCwd.Provider
								value={
									message.from === "operator"
										? undefined
										: (world.characters.find((person) => person.id === message.from)?.facts?.cwd ??
											world.dormant?.find((person) => person.id === message.from)?.cwd)
								}
							>
								{channel ? (
									<Markdown text={message.body} onLink={(href, file) => followLink(message.from, href, file)} />
								) : (
									<FileReferenceText text={message.body} />
								)}
							</FileReferenceCwd.Provider>
						</div>
					</div>
				</ActionableMessage>
			</Fragment>
		);
	});
}

/** The operator reads as You and the runtime as Pi, not by their internal addresses. */
const displayName = (id: string, name: string) => (id === "operator" ? "You" : id === "harness" ? "Pi" : name);

/** Consecutive messages from one author within this span read as one block, as in Slack. */
const GROUP_MS = 5 * 60_000;
const dayOf = (at: number) => new Date(at).toDateString();
function dayLabel(at: number): string {
	const today = new Date();
	const yesterday = new Date(today.getTime() - 86_400_000);
	if (dayOf(at) === today.toDateString()) return "Today";
	if (dayOf(at) === yesterday.toDateString()) return "Yesterday";
	return new Date(at).toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
		...(new Date(at).getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
	});
}
