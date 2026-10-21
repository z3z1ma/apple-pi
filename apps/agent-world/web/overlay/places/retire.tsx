// The retire form: a small themed dialog, drawn like the rename form, opened from a person's actions. It asks why the
// person leaves, sends `retire`, and shows the receipt; the person then sleeps at the inn marked as a former member.
import { useState, useSyncExternalStore } from "react";
import type { WorldSnapshot } from "../../../src/world.js";
import { portraitFor } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { PlaceDialog } from "./place-dialog.js";
import type { Progress } from "./place-panels.js";
import { retiring } from "./retire-state.js";
import "./recruit.css";

export function RetirePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(retiring.subscribe, retiring.get);
	if (!state.open) return null;
	return <RetireForm key={state.opening} opened={state.open} world={world} />;
}

function RetireForm({ opened, world }: { opened: { id: string; name: string }; world: WorldSnapshot | undefined }) {
	const theme = useTheme();
	const character = world?.characters.find((c) => c.id === opened.id);
	const [reason, setReason] = useState("");
	const [progress, setProgress] = useState<Progress>();
	const ready = reason.trim() !== "" && progress?.state !== "sending";
	const title = say(theme, "retire-title", { name: opened.name });
	const portrait =
		theme && character ? portraitFor(theme, character, progress?.state === "done" ? "happy" : "neutral") : undefined;

	const send = async () => {
		if (!ready) return;
		setProgress({ state: "sending", text: `${opened.name}\u2026` });
		setProgress(await retiring.send(opened, reason));
	};

	return (
		<PlaceDialog label={title} className="aw-recruit aw-rename aw-retire" onClose={() => retiring.close()}>
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{portrait && <img src={portrait} alt={opened.name} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{title}</h2>
					<p className="aw-place-says">
						Its session ends and it leaves the organization; it sleeps at the inn, and a manager can call it back.
					</p>
				</div>
			</header>
			{progress && progress.state !== "sending" ? (
				<div className="aw-letter aw-letter-sent aw-recruit-sent">
					<span className={`aw-progress aw-progress-${progress.state}`} role="status">
						{progress.text}
					</span>
					<div className="aw-letter-actions">
						{progress.state === "done" ? (
							<button type="button" className="aw-button aw-button-strong" onClick={() => retiring.close()}>
								Close
							</button>
						) : (
							<>
								<button type="button" className="aw-button" onClick={() => retiring.close()}>
									Cancel
								</button>
								<button type="button" className="aw-button aw-button-strong" onClick={() => setProgress(undefined)}>
									Try again
								</button>
							</>
						)}
					</div>
				</div>
			) : (
				<form
					className="aw-letter aw-recruit-form"
					onSubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<label className="aw-letter-to aw-recruit-brief">
						<span>Reason</span>
						<textarea
							aria-label="Reason"
							className="aw-letter-body"
							placeholder={say(theme, "retire-reason")}
							value={reason}
							rows={3}
							onChange={(event) => setReason(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
							}}
						/>
					</label>
					<div className="aw-letter-actions">
						<button type="button" className="aw-button" onClick={() => retiring.close()}>
							Cancel
						</button>
						<button type="submit" className="aw-button aw-button-strong aw-button-end" disabled={!ready}>
							{say(theme, "retire-send")}
						</button>
					</div>
					{progress?.state === "sending" && (
						<span className="aw-progress aw-progress-sending" role="status">
							{progress.text}
						</span>
					)}
				</form>
			)}
		</PlaceDialog>
	);
}
