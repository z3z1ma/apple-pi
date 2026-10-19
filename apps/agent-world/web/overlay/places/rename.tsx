// The rename form (ticket 12): a small themed dialog, drawn like the recruiting form, opened from an agent's
// right-click menu in the world or its side-panel row. It holds the agent's current name; saving sends `rename` and
// shows the receipt. A blank name sends nothing.
import { useState, useSyncExternalStore } from "react";
import { NAME_MAX, type WorldSnapshot } from "../../../src/world.js";
import { portraitFor } from "../../looks.js";
import { useTheme } from "../../theme-store.js";
import { PlaceDialog } from "./place-dialog.js";
import type { Progress } from "./place-panels.js";
import { cleanName, renaming } from "./rename-state.js";
import "./recruit.css";

export function RenamePanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(renaming.subscribe, renaming.get);
	if (!state.open) return null;
	return <RenameForm key={state.opening} opened={state.open} world={world} />;
}

function RenameForm({ opened, world }: { opened: { id: string; name: string }; world: WorldSnapshot | undefined }) {
	const theme = useTheme();
	// The name it had when the form opened heads the form; the portrait follows the character as it is now.
	const character = world?.characters.find((c) => c.id === opened.id);
	const [name, setName] = useState(opened.name);
	const [progress, setProgress] = useState<Progress>();
	const clean = cleanName(name);
	const ready = clean !== "" && clean !== opened.name && progress?.state !== "sending";
	const title = `Rename ${opened.name}`;
	const portrait =
		theme && character ? portraitFor(theme, character, progress?.state === "done" ? "happy" : "neutral") : undefined;

	const send = async () => {
		if (!ready) return;
		setProgress({ state: "sending", text: `Renaming ${opened.name}\u2026` });
		setProgress(await renaming.send(opened, clean));
	};

	return (
		<PlaceDialog label={title} className="aw-recruit aw-rename" onClose={() => renaming.close()}>
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{portrait && <img src={portrait} alt={opened.name} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{title}</h2>
					<p className="aw-place-says">Its Pi session takes the new name, wherever it shows.</p>
				</div>
			</header>
			{progress && progress.state !== "sending" ? (
				<div className="aw-letter aw-letter-sent aw-recruit-sent">
					<span className={`aw-progress aw-progress-${progress.state}`} role="status">
						{progress.text}
					</span>
					<div className="aw-letter-actions">
						{progress.state === "done" ? (
							<button type="button" className="aw-button aw-button-strong" onClick={() => renaming.close()}>
								Close
							</button>
						) : (
							<>
								<button type="button" className="aw-button" onClick={() => renaming.close()}>
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
					<label className="aw-letter-to">
						<span>Name</span>
						<input
							type="text"
							aria-label="Name"
							value={name}
							maxLength={NAME_MAX}
							spellCheck={false}
							autoComplete="off"
							onFocus={(event) => event.currentTarget.select()}
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<div className="aw-letter-actions">
						<button type="button" className="aw-button" onClick={() => renaming.close()}>
							Cancel
						</button>
						<button type="submit" className="aw-button aw-button-strong" disabled={!ready}>
							Rename
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
