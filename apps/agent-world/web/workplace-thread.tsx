import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Markdown } from "./overlay/conversation/transcript.js";
import { useWindowFocus } from "./use-window-focus.js";
import { CommunicationDialog, CommunicationRecipients } from "./workplace-communications.js";
import { PersonAvatar, PersonName } from "./workplace-people.js";

const api = window.agentWorld;
const attempts = new Map<string, { id: string; label: string; body?: string; result?: CommunicationResult }>();
const notificationDrafts = new Map<string, string[]>();

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keyed reader keeps paging, active-following, mutation recovery and draft ownership in one lifecycle
export function ThreadPane({
	id,
	channel,
	channelLabel,
	world,
	drafts,
}: {
	id: string;
	channel?: Pick<WorkplaceThread, "lastSeq">;
	channelLabel?: string;
	world: WorldSnapshot;
	drafts: Map<string, string>;
}) {
	const [page, setPage] = useState<ConversationPage>();
	const [unreadAfter, setUnreadAfter] = useState<number>();
	const [draft, setDraft] = useState(drafts.get(id) ?? "");
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
		setNote(describe(result));
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
		void run(
			channel ? "Post" : "Reply",
			(attempt) => api.communications.post({ attempt, thread: id, body: draft, ...(channel ? { notify } : {}) }),
			draft,
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
		<article className={`wp-thread${channel ? " wp-thread-channel" : ""}`}>
			<header className="wp-thread-header">
				{!channel && <h1>{thread?.name ?? "Reading conversation..."}</h1>}
				<p>
					{thread?.participants.map((person, index) => (
						<span key={person.id}>
							{index > 0 && ", "}
							<PersonName id={person.id} name={person.id === "operator" ? "You" : person.name} />
						</span>
					))}
				</p>
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
			{thread?.purpose && <p className="wp-thread-note">{thread.purpose}</p>}
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
				{search && <p role="status">Search results are inspection only; catch-up is unchanged.</p>}
				{page && (
					<ThreadMessages
						world={world}
						thread={page.thread}
						messages={search?.messages ?? page.messages}
						channel={!!channel}
						unreadAfter={channel ? unreadAfter : undefined}
						followLink={(author, href, file) => void followLink(author, href, file)}
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
				{attempt && (
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
						{channel && (
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
									Only selected people receive attention. Names in prose are just text; recipients must already have
									access.
								</p>
							</details>
						)}
						<label>
							{channel ? "Post to channel as operator" : "Reply to everyone"}
							<textarea
								aria-label={channel ? "Post to channel" : "Reply to everyone"}
								placeholder={channel ? "Write to this channel..." : "Write your reply..."}
								value={draft}
								disabled={locked}
								onChange={(event) => {
									setDraft(event.target.value);
									drafts.set(id, event.target.value);
								}}
								onKeyDown={(event) => {
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
								{channel ? "Enter to post · Shift + Enter for a new line" : "Ctrl / Command + Enter to reply"}
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
						Previewing #{channelLabel ?? thread.name}. Access permits reading and posting; joining adds catch-up
						activity, not alerts.
					</p>
					{thread.permissions.join && (
						<button
							type="button"
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
}: {
	world: WorldSnapshot;
	thread: ConversationInfo;
	messages: ConversationMessage[];
	channel: boolean;
	canPin: boolean;
	pin: (seq: number) => void;
	unreadAfter?: number;
	followLink: (author: string, href: string, file: boolean) => void;
}) {
	const firstUnread =
		unreadAfter === undefined
			? undefined
			: messages.find((message) => message.seq > unreadAfter && message.from !== "operator")?.seq;
	return messages.map((message) => (
		<Fragment key={message.id}>
			{message.seq === firstUnread && (
				<div className="wp-unread-divider">
					<span aria-hidden="true">New messages</span>
					<hr aria-label="New messages" />
				</div>
			)}
			<article className="wp-message" id={`message-${message.seq}`}>
				<PersonAvatar
					id={message.from}
					name={message.from === "operator" ? "You" : message.fromName}
					className="wp-message-avatar"
				/>
				<div className="wp-message-content">
					<header>
						<strong>
							<PersonName id={message.from} name={message.from === "operator" ? "You" : message.fromName} />
						</strong>
						<time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleString()}</time>
						<span className="wp-message-reference" title={`${thread.id}#${message.seq}`}>
							#{message.seq}
						</span>
						{canPin && (
							<button
								className="wp-message-pin"
								type="button"
								aria-label={`Pin message ${message.seq}`}
								onClick={() => pin(message.seq)}
							>
								Pin
							</button>
						)}
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
			</article>
		</Fragment>
	));
}
