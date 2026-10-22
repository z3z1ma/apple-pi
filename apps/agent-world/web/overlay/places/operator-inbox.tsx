import { useEffect, useRef, useState } from "react";
import type { MailThread, MailThreadSummary } from "../../../src/world.js";
import "./operator-inbox.css";

/** Reading clears only the displayed messages; a later arrival keeps its unread badge until Read latest. */
export function OperatorInbox({ threads }: { threads: MailThreadSummary[] }) {
	const [thread, setThread] = useState<MailThread>();
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const request = useRef(0);
	useEffect(
		() => () => {
			request.current++;
		},
		[],
	);
	const read = async (id: string) => {
		const token = ++request.current;
		setPending(true);
		setError("");
		try {
			const result = await window.agentWorld.readThread(id);
			if (request.current !== token) return;
			if (result.ok) setThread(result.thread);
			else setError(result.reason);
		} catch (failure) {
			if (request.current === token) setError(String(failure));
		} finally {
			if (request.current === token) setPending(false);
		}
	};
	const send = async () => {
		if (!thread) return;
		const id = thread.id;
		const token = ++request.current;
		setPending(true);
		setError("");
		try {
			const receipt = await window.agentWorld.replyThread(id, drafts[id] ?? "");
			if (request.current !== token) return;
			if (!receipt.ok) setError(receipt.reason ?? "Reply failed.");
			else {
				setDrafts((before) => ({ ...before, [id]: "" }));
				await read(id);
			}
		} catch (failure) {
			if (request.current === token) setError(String(failure));
		} finally {
			if (request.current === token) setPending(false);
		}
	};
	return (
		<section className="aw-operator-inbox" aria-label="Your inbox">
			<h3>Your inbox</h3>
			{threads.length === 0 ? (
				<p className="aw-empty">No conversations addressed to you.</p>
			) : (
				<ul>
					{threads.map((item) => (
						<li key={item.id}>
							<button
								type="button"
								className="aw-button aw-thread-choice"
								disabled={pending}
								aria-pressed={thread?.id === item.id}
								onClick={() => void read(item.id)}
							>
								<span>{item.subject}</span>
								{item.unread > 0 && <strong>{item.unread} new · Needs you</strong>}
							</button>
						</li>
					))}
				</ul>
			)}
			{thread && (
				<article className="aw-thread" aria-label={thread.subject}>
					<h4>{thread.subject}</h4>
					<p className="aw-thread-people">
						{thread.participants.map((p) => (p.id === "operator" ? "You" : p.name)).join(", ")}
					</p>
					<button type="button" className="aw-button" disabled={pending} onClick={() => void read(thread.id)}>
						Read latest
					</button>
					{thread.messages.map((message) => (
						<div className="aw-thread-message" key={message.seq}>
							<strong>{message.from === "operator" ? "You" : message.name}</strong>
							<time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleString()}</time>
							<p>{message.body}</p>
						</div>
					))}
					{thread.closed ? (
						<p>Conversation closed.</p>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void send();
							}}
						>
							<label>
								Reply to everyone
								<textarea
									className="aw-letter-body"
									aria-label="Reply to everyone"
									disabled={pending}
									value={drafts[thread.id] ?? ""}
									onChange={(event) => setDrafts({ ...drafts, [thread.id]: event.target.value })}
								/>
							</label>
							<button type="submit" className="aw-button" disabled={pending || !drafts[thread.id]?.trim()}>
								Send reply
							</button>
						</form>
					)}
				</article>
			)}
			{error && <p role="alert">{error}</p>}
		</section>
	);
}
