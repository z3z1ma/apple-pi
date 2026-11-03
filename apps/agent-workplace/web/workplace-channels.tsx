import { useEffect, useRef, useState } from "react";
import type { ConversationInfo } from "../src/communications.js";
import type { WorldSnapshot } from "../src/world.js";
import { CommunicationDialog, CommunicationRecipients } from "./workplace-communications.js";
import { Select } from "./workplace-fields.js";
import { Icon } from "./workplace-icon.js";
import { orgPeople } from "./workplace-org.js";

const api = window.agentWorkplace;

const PAGE = 50;

const SEARCH_PAUSE_MS = 200;
let pendingCreation:
	| { attempt: string; scopeHead: string; name: string; purpose: string; invite: string[] }
	| undefined;

export function ChannelBrowser({
	world,
	close,
	open,
}: {
	world: WorldSnapshot;
	close: () => void;
	open: (channel: ConversationInfo) => void;
}) {
	const [creating, setCreating] = useState(!!pendingCreation);
	const [query, setQuery] = useState("");
	const [archived, setArchived] = useState<"exclude" | "include" | "only">("exclude");
	const [scopeHead, setScopeHead] = useState(pendingCreation?.scopeHead ?? "");
	const [threads, setThreads] = useState<ConversationInfo[]>([]);
	const [cursor, setCursor] = useState<string>();
	const [name, setName] = useState(pendingCreation?.name ?? "");
	const [purpose, setPurpose] = useState(pendingCreation?.purpose ?? "");
	const [invite, setInvite] = useState<string[]>(pendingCreation?.invite ?? []);
	const [busy, setBusy] = useState(false);
	const [searching, setSearching] = useState(true);
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState<string | undefined>(pendingCreation?.attempt);
	const [notRecorded, setNotRecorded] = useState(false);
	const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
	const searchOptions = useRef<
		{ query?: string; archived: "exclude" | "include" | "only"; scopeHead?: string; limit: number } | undefined
	>(undefined);
	const latest = useRef(0);
	const mounted = useRef(true);
	const people = orgPeople(world);
	const ids = new Set(people.map((person) => person.character.id));
	const heads = people.filter((person) => !person.parent || !ids.has(person.parent));
	const nameOf = (id: string) => people.find((person) => person.character.id === id)?.character.name ?? id;
	const find = async (continuation?: string) => {
		const request = ++latest.current;
		setSearching(true);
		setError("");
		try {
			const options =
				continuation && searchOptions.current
					? searchOptions.current
					: { query: query.trim() || undefined, archived, scopeHead: scopeHead || undefined, limit: PAGE };
			const result = await api.communications.findChannels({ ...options, cursor: continuation });
			if (!mounted.current || request !== latest.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			searchOptions.current = options;
			setThreads((previous) => (continuation ? [...previous, ...result.value.threads] : result.value.threads));
			setCursor(result.value.next_cursor);
		} catch (failure) {
			if (mounted.current && request === latest.current) setError(String(failure));
		} finally {
			if (mounted.current && request === latest.current) setSearching(false);
		}
	};
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: find reads these same filters
	useEffect(() => {
		if (creating) return;
		const timer = setTimeout(() => void find(), searchOptions.current ? SEARCH_PAUSE_MS : 0);
		return () => clearTimeout(timer);
	}, [query, archived, scopeHead, creating]);
	const recover = async () => {
		if (!attempt) return;
		setBusy(true);
		setError("");
		try {
			const result = await api.communications.status({ attempt });
			if (!mounted.current) return;
			setNotRecorded(result.outcome === "not_recorded");
			if (result.outcome === "applied" && result.effect) {
				pendingCreation = undefined;
				open(result.effect.thread);
			} else {
				setError(result.reason ?? `Creation ${result.outcome}. No replacement channel was created.`);
				if (result.outcome === "refused") {
					pendingCreation = undefined;
					setAttempt(undefined);
				}
			}
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	const create = async () => {
		if (!scopeHead || !name.trim() || !purpose.trim() || busy || attempt) return;
		const identity = crypto.randomUUID();
		pendingCreation = { attempt: identity, scopeHead, name: name.trim(), purpose: purpose.trim(), invite: [...invite] };
		setAttempt(identity);
		setBusy(true);
		setError("");
		try {
			const result = await api.communications.createChannel({
				attempt: identity,
				scopeHead,
				name: name.trim(),
				purpose: purpose.trim(),
				invite,
			});
			if (!mounted.current) return;
			if (result.outcome === "applied" && result.effect) {
				pendingCreation = undefined;
				open(result.effect.thread);
			} else {
				setError(result.reason ?? `Creation ${result.outcome}. Check this attempt before creating again.`);
				if (result.outcome === "refused") {
					pendingCreation = undefined;
					setAttempt(undefined);
				}
			}
		} catch (failure) {
			if (mounted.current) setError(`Creation uncertain: ${String(failure)}`);
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	const locked = busy || !!attempt;
	return (
		<CommunicationDialog
			title={creating ? "Create topic channel" : "Discover channels"}
			busy={busy}
			close={close}
			wide={!creating}
		>
			{creating ? (
				<form
					className="wp-modal-form"
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<p className="wp-modal-lede">
						Everyone in the chosen organization can find, read and post. Invited people get access and follow it.
						Creating is quiet: nobody starts work.
					</p>
					<div className="wp-field">
						<span>Organization scope</span>
						<Select
							label="Organization scope"
							value={scopeHead}
							placeholder="Choose an organization"
							disabled={locked}
							options={heads.map((person) => ({
								value: person.character.id,
								label: person.character.name,
								detail: person.character.facts?.title ?? "",
							}))}
							onChange={setScopeHead}
						/>
					</div>
					<label className="wp-field">
						<span>Channel name</span>
						<span className="wp-channel-name-input">
							<span aria-hidden="true">#</span>
							<input
								required
								value={name}
								placeholder="checkout-review"
								disabled={locked}
								onChange={(event) => setName(event.target.value)}
							/>
						</span>
					</label>
					<label className="wp-field">
						<span>Purpose</span>
						<textarea
							required
							value={purpose}
							placeholder="What this channel is for"
							disabled={locked}
							onChange={(event) => setPurpose(event.target.value)}
						/>
					</label>
					<CommunicationRecipients world={world} label="Invite" value={invite} onChange={setInvite} disabled={locked} />
					{error && <p role="alert">{error}</p>}
					<footer className="wp-modal-footer">
						<button type="button" className="wp-button" disabled={locked} onClick={() => setCreating(false)}>
							Back
						</button>
						<button
							type="submit"
							className="wp-button wp-button-primary"
							disabled={locked || !scopeHead || !name.trim() || !purpose.trim()}
						>
							Create channel
						</button>
					</footer>
				</form>
			) : (
				<>
					<form
						className="wp-channel-search"
						onSubmit={(event) => {
							event.preventDefault();
							void find();
						}}
					>
						<label className="wp-channel-find">
							<Icon name="search" />
							<input
								aria-label="Name or purpose"
								placeholder="Search by name or purpose"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
						</label>
						<div className="wp-channel-filters">
							<Select
								label="Organization filter"
								value={scopeHead}
								options={[
									{ value: "", label: "All organizations" },
									...heads.map((person) => ({ value: person.character.id, label: person.character.name })),
								]}
								onChange={setScopeHead}
							/>
							<Select
								label="Archive state"
								value={archived}
								options={[
									{ value: "exclude" as const, label: "Active channels" },
									{ value: "include" as const, label: "Active and archived" },
									{ value: "only" as const, label: "Archived channels" },
								]}
								onChange={setArchived}
							/>
							<button
								type="button"
								className="wp-button wp-button-primary"
								disabled={locked}
								onClick={() => setCreating(true)}
							>
								<Icon name="plus" />
								Create topic channel
							</button>
						</div>
					</form>
					<section className="wp-channel-discovery" aria-label="Accessible channels" aria-busy={searching}>
						{threads.map((thread) => (
							<button
								key={thread.id}
								type="button"
								className="wp-channel-row"
								aria-label={`Open ${thread.name}`}
								onClick={() => open(thread)}
							>
								<span className="wp-channel-row-name">
									<span aria-hidden="true">#</span>
									{thread.name}
									{thread.archived && <small>Archived</small>}
								</span>
								<span className="wp-channel-row-purpose">{thread.purpose ?? "Structural channel"}</span>
								<span className="wp-channel-row-meta">
									{thread.following ? (
										<span className="wp-channel-following">
											<Icon name="check" />
											Following
										</span>
									) : (
										<span>Not following</span>
									)}
									{thread.scope_head && <span>{nameOf(thread.scope_head)}&rsquo;s organization</span>}
									<span>{thread.channel_type}</span>
									{thread.pinned && <span>Pinned #{thread.pinned.seq}</span>}
								</span>
								<span className="wp-channel-row-open" aria-hidden="true">
									Open
								</span>
							</button>
						))}
						{!searching && !threads.length && !error && (
							<div className="wp-channel-empty">
								<p>No channels match.</p>
								<button type="button" className="wp-button" onClick={() => setCreating(true)}>
									Create a channel instead
								</button>
							</div>
						)}
						{cursor && (
							<button
								type="button"
								className="wp-pill wp-channel-more"
								disabled={searching}
								onClick={() => void find(cursor)}
							>
								{searching ? "Loading\u2026" : "More channels"}
							</button>
						)}
					</section>
					{error && <p role="alert">{error}</p>}
				</>
			)}
			{attempt && (
				<p className="wp-thread-attempt">
					Attempt: {attempt}{" "}
					<button type="button" className="wp-button" disabled={busy} onClick={() => void recover()}>
						Check creation outcome
					</button>
				</p>
			)}
			{notRecorded && attempt && (
				<div className="wp-communication-restart">
					<p>
						The runtime has no durable record for this attempt. A disconnected original request could still arrive;
						creating again can duplicate the channel.
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
						className="wp-button"
						disabled={busy || !acknowledgeDuplicate}
						onClick={() => {
							pendingCreation = undefined;
							setAttempt(undefined);
							setNotRecorded(false);
							setAcknowledgeDuplicate(false);
							setError("");
						}}
					>
						Prepare a new creation attempt
					</button>
				</div>
			)}
		</CommunicationDialog>
	);
}
