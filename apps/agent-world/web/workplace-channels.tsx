import { useEffect, useRef, useState } from "react";
import type { ConversationInfo } from "../src/communications.js";
import type { WorldSnapshot } from "../src/world.js";
import { CommunicationDialog, CommunicationRecipients } from "./workplace-communications.js";
import { orgPeople } from "./workplace-org.js";

const api = window.agentWorld;
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
	const [limit, setLimit] = useState(50);
	const [threads, setThreads] = useState<ConversationInfo[]>([]);
	const [cursor, setCursor] = useState<string>();
	const [name, setName] = useState(pendingCreation?.name ?? "");
	const [purpose, setPurpose] = useState(pendingCreation?.purpose ?? "");
	const [invite, setInvite] = useState<string[]>(pendingCreation?.invite ?? []);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState<string | undefined>(pendingCreation?.attempt);
	const [notRecorded, setNotRecorded] = useState(false);
	const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
	const searchOptions = useRef<
		{ query?: string; archived: "exclude" | "include" | "only"; scopeHead?: string; limit: number } | undefined
	>(undefined);
	const mounted = useRef(true);
	const people = orgPeople(world);
	const ids = new Set(people.map((person) => person.character.id));
	const heads = people.filter((person) => !person.parent || !ids.has(person.parent));
	const find = async (continuation?: string) => {
		setBusy(true);
		setError("");
		try {
			const options =
				continuation && searchOptions.current
					? searchOptions.current
					: { query: query.trim() || undefined, archived, scopeHead: scopeHead || undefined, limit };
			const result = await api.communications.findChannels({ ...options, cursor: continuation });
			if (!mounted.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			searchOptions.current = options;
			setThreads((previous) => (continuation ? [...previous, ...result.value.threads] : result.value.threads));
			setCursor(result.value.next_cursor);
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: opening discovers metadata once; filters run on explicit Search
	useEffect(() => {
		mounted.current = true;
		void find();
		return () => {
			mounted.current = false;
		};
	}, []);
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
	return (
		<CommunicationDialog title={creating ? "Create topic channel" : "Discover channels"} busy={busy} close={close}>
			<p>
				Topic channels share context within their recorded organization. Joining follows activity; invitations grant
				retained-history access. Neither starts people or assigns work.
			</p>
			<div className="wp-channel-tools">
				<button type="button" disabled={busy || !!attempt} onClick={() => setCreating(!creating)}>
					{creating ? "Back to discovery" : "Create topic channel"}
				</button>
			</div>
			{creating ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void create();
					}}
				>
					<label>
						Organization scope
						<select
							required
							value={scopeHead}
							disabled={busy || !!attempt}
							onChange={(event) => setScopeHead(event.target.value)}
						>
							<option value="">Choose an organization</option>
							{heads.map((person) => (
								<option value={person.character.id} key={person.character.id}>
									{person.character.name}
								</option>
							))}
						</select>
					</label>
					<label>
						Channel name
						<input
							required
							value={name}
							disabled={busy || !!attempt}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label>
						Purpose
						<textarea
							required
							value={purpose}
							disabled={busy || !!attempt}
							onChange={(event) => setPurpose(event.target.value)}
						/>
					</label>
					<CommunicationRecipients
						world={world}
						label="Invite"
						value={invite}
						onChange={setInvite}
						disabled={busy || !!attempt}
					/>
					<p>
						Everyone in this recorded branch can discover, read and post. Invited people gain explicit access and follow
						it. Creation is quiet.
					</p>
					<footer>
						<button type="submit" disabled={busy || !!attempt || !scopeHead || !name.trim() || !purpose.trim()}>
							Create channel
						</button>
					</footer>
				</form>
			) : (
				<>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void find();
						}}
					>
						<label>
							Name or purpose
							<input value={query} onChange={(event) => setQuery(event.target.value)} />
						</label>
						<label>
							Organization filter
							<select value={scopeHead} onChange={(event) => setScopeHead(event.target.value)}>
								<option value="">All accessible organizations</option>
								{heads.map((person) => (
									<option key={person.character.id} value={person.character.id}>
										{person.character.name}
									</option>
								))}
							</select>
						</label>
						<label>
							Archive state
							<select value={archived} onChange={(event) => setArchived(event.target.value as typeof archived)}>
								<option value="exclude">Active channels</option>
								<option value="include">Active and archived</option>
								<option value="only">Archived channels</option>
							</select>
						</label>
						<label>
							Page size
							<input
								type="number"
								min="1"
								step="1"
								required
								value={limit}
								onChange={(event) => setLimit(Number(event.target.value))}
							/>
						</label>
						<button type="submit" disabled={busy || !Number.isSafeInteger(limit) || limit < 1}>
							Search channels
						</button>
					</form>
					<section className="wp-channel-discovery" aria-label="Accessible channels">
						{threads.map((thread) => (
							<article key={thread.id}>
								<h3>{thread.name}</h3>
								<p>{thread.purpose ?? "Structural channel"}</p>
								{thread.scope_head && (
									<p>
										Recorded scope:{" "}
										{people.find((person) => person.character.id === thread.scope_head)?.character.name ??
											thread.scope_head}
									</p>
								)}
								{thread.pinned && <p>Current context: message #{thread.pinned.seq}</p>}
								<p>
									{thread.channel_type} · {thread.following ? "Following" : "Not following"}
									{thread.archived ? " · Archived" : ""}
								</p>
								<button type="button" disabled={busy} onClick={() => open(thread)}>
									Open {thread.name}
								</button>
							</article>
						))}
						{!busy && !threads.length && <p>No matching accessible channels.</p>}
					</section>
					{cursor && (
						<button type="button" disabled={busy} onClick={() => void find(cursor)}>
							More channels
						</button>
					)}
				</>
			)}
			{error && <p role="alert">{error}</p>}
			{attempt && (
				<p className="wp-thread-attempt">
					Attempt: {attempt}{" "}
					<button type="button" disabled={busy} onClick={() => void recover()}>
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
