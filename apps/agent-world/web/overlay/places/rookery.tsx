// The rookery keeper's view (ticket 16): mail waiting for sleeping agents, recent mail between agents, and writing a
// letter to any agent, awake or asleep, as the operator. A letter goes as a `mail` command from the operator's own
// label; its receipt shows here (delivered, or waiting until its receiver wakes).
import { useState } from "react";
import type { WorldSnapshot } from "../../../src/world.js";
import { portraitOf } from "../../looks.js";
import { MailList } from "./mail-list.js";
import { PlaceDialog } from "./place-dialog.js";
import { type Progress, placeActions, placePanels } from "./place-panels.js";

export function RookeryView({ world }: { world: WorldSnapshot | undefined }) {
	const { theme, write, letterTo } = placePanels.get();
	const [writing, setWriting] = useState(write === true);
	const mail = world?.mail ?? [];
	const waiting = mail.filter((item) => item.state === "waiting");
	const asleep = new Set((world?.dormant ?? []).map((agent) => agent.id));
	const forSleepers = waiting.filter((item) => asleep.has(item.to));
	const recent = mail.filter((item) => !forSleepers.includes(item));
	const host = theme ? portraitOf(theme, "rookery-keeper", mail.length ? "happy" : "neutral") : undefined;
	const greeting = mail.length
		? `${forSleepers.length ? `${forSleepers.length} ${forSleepers.length === 1 ? "letter waits" : "letters wait"} for sleepers. ` : ""}Shall I send a bird for you?`
		: "No birds have flown yet today. Shall I send one for you?";

	return (
		<PlaceDialog label="The rookery" className="aw-rookery">
			<header className="aw-place-head">
				<div className="aw-place-portrait">{host && <img src={host} alt="The rookery keeper" draggable={false} />}</div>
				<div className="aw-place-heading">
					<h2>The rookery</h2>
					<p className="aw-place-says">&ldquo;{greeting}&rdquo;</p>
				</div>
				{!writing && (
					<button type="button" className="aw-button aw-button-strong aw-place-act" onClick={() => setWriting(true)}>
						Write a letter
					</button>
				)}
			</header>
			{writing ? (
				<LetterForm world={world} to={letterTo} onDone={() => setWriting(false)} />
			) : (
				<div className="aw-place-scroll">
					{forSleepers.length > 0 && (
						<section className="aw-place-section" aria-label="Waiting for sleepers">
							<h3>Waiting for sleepers</h3>
							<MailList mail={forSleepers} label="Waiting for sleepers" />
						</section>
					)}
					<section className="aw-place-section" aria-label="Recent mail">
						<h3>Recent mail</h3>
						{recent.length ? (
							<MailList mail={recent} label="Recent mail" />
						) : (
							<p className="aw-place-empty">No mail yet.</p>
						)}
					</section>
				</div>
			)}
		</PlaceDialog>
	);
}

/** A letter to any agent: awake ones first, then those asleep at the inn, whose letters wait until they wake. */
function LetterForm({ world, to, onDone }: { world: WorldSnapshot | undefined; to?: string; onDone: () => void }) {
	const awake = world?.characters ?? [];
	const asleep = world?.dormant ?? [];
	const [recipient, setRecipient] = useState(to ?? awake[0]?.id ?? asleep[0]?.id ?? "");
	const [body, setBody] = useState("");
	const [progress, setProgress] = useState<Progress>();
	const chosen =
		awake.find((c) => c.id === recipient) ??
		asleep.find((agent) => agent.id === recipient) ??
		({ id: recipient, name: recipient } as const);
	const isAsleep = asleep.some((agent) => agent.id === recipient);

	const send = async () => {
		if (!body.trim() || !recipient) return;
		setProgress({ state: "sending", text: `The bird takes off for ${chosen.name}\u2026` });
		setProgress(await placeActions.sendMail({ id: recipient, name: chosen.name, asleep: isAsleep }, body));
	};

	if (progress && progress.state !== "sending")
		return (
			<div className="aw-letter aw-letter-sent">
				<span className={`aw-progress aw-progress-${progress.state}`} role="status">
					{progress.text}
				</span>
				<div className="aw-letter-actions">
					<button type="button" className="aw-button" onClick={onDone}>
						Back to the mail
					</button>
					<button
						type="button"
						className="aw-button aw-button-strong"
						onClick={() => {
							setProgress(undefined);
							if (progress.state === "done") setBody("");
						}}
					>
						{progress.state === "done" ? "Write another" : "Try again"}
					</button>
				</div>
			</div>
		);

	return (
		<form
			className="aw-letter"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<label className="aw-letter-to">
				<span>To</span>
				<select aria-label="To" value={recipient} onChange={(event) => setRecipient(event.target.value)}>
					{awake.length > 0 && (
						<optgroup label="Awake">
							{awake.map((character) => (
								<option key={character.id} value={character.id}>
									{character.name}
								</option>
							))}
						</optgroup>
					)}
					{asleep.length > 0 && (
						<optgroup label="Asleep at the inn">
							{asleep.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{`${agent.name} (asleep)`}
								</option>
							))}
						</optgroup>
					)}
				</select>
			</label>
			<textarea
				aria-label="Letter"
				className="aw-letter-body"
				placeholder={`Dear ${chosen.name}\u2026`}
				value={body}
				rows={7}
				onChange={(event) => setBody(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
				}}
			/>
			<p className="aw-letter-note">
				{isAsleep
					? `${chosen.name} is asleep at the inn: the letter waits until it wakes.`
					: "Signed as you; it arrives as a new message in its conversation."}
			</p>
			<div className="aw-letter-actions">
				<button type="button" className="aw-button" onClick={onDone}>
					Back to the mail
				</button>
				<button
					type="submit"
					className="aw-button aw-button-strong"
					disabled={!body.trim() || !recipient || progress?.state === "sending"}
				>
					Send
				</button>
			</div>
			{progress?.state === "sending" && (
				<span className="aw-progress aw-progress-sending" role="status">
					{progress.text}
				</span>
			)}
		</form>
	);
}
