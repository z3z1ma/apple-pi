// The interface around the world, in Old School RuneScape's layout and the theme's style: the minimap with its orbs at
// the top right, the tabbed side panel below it, and the chatbox at the bottom left. Every action on a character works
// from here wherever the avatar is; walking is for immersion. It frames the world rather than burying it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Character, PlaceRef } from "../../../src/world.js";
import { placeKey } from "../../../src/world.js";
import type { ViewStore, WorldIntent } from "../../view-state.js";
import type { WorldStore } from "../../world-store.js";
import { CharacterCard } from "./character-card.js";
import { Chatbox, type ChatKind, type ChatLine } from "./chatbox.js";
import "./interface.css";
import { placeActions } from "../places/place-panels.js";
import { Minimap } from "./minimap.js";
import { orbCounts, placeName } from "./model.js";
import type { CharacterAction } from "./rows.js";
import { SidePanel, type Tab } from "./side-panel.js";

/** A place's name after "in" or "to": "the guild hall", and "the inn" for a name that has its own article. */
const theName = (name: string) =>
	/^the /i.test(name) ? `t${name.slice(1)}` : `the ${name.charAt(0).toLowerCase()}${name.slice(1)}`;

/** Lines the interface itself adds to the chatbox (what the operator did here), kept beside the runtime's feed. */
const GAME_KEPT = 100;

export function Interface({ store, view }: { store: WorldStore; view: ViewStore }) {
	const world = useSyncExternalStore(store.subscribe, store.get);
	const state = useSyncExternalStore(view.subscribe, view.get);
	const feed = useSyncExternalStore(store.subscribeFeed, store.feed);
	const [tab, setTab] = useState<Tab>("agents");
	const [folded, setFolded] = useState(false);
	const [selected, setSelected] = useState<string>();
	const [examining, setExamining] = useState<string>();
	const [hidden, setHidden] = useState<Set<ChatKind>>(new Set());
	const [chatFolded, setChatFolded] = useState(false);
	const [game, setGame] = useState<ChatLine[]>([]);
	const lineCount = useRef(0);

	const say = useCallback((text: string) => {
		const line: ChatLine = {
			key: `game:${++lineCount.current}`,
			at: Date.now(),
			kind: "game",
			character: null,
			name: null,
			text,
		};
		setGame((lines) => [...lines, line].slice(-GAME_KEPT));
	}, []);

	// Where you are, as the world's title says.
	const placeTitle = state.title;
	useEffect(() => {
		if (placeTitle) say(`You are in ${theName(placeTitle)}.`);
	}, [placeTitle, say]);

	// The interface handles examining and the terminal itself, whoever asks (a row here, or the world's own menu).
	const characters = world?.characters;
	const find = (id: string) => characters?.find((character) => character.id === id);
	const findRef = useRef(find);
	findRef.current = find;
	useEffect(
		() =>
			view.onIntent((intent) => {
				if (intent.kind === "examine") setExamining(intent.character);
				if (intent.kind !== "terminal") return;
				const name = findRef.current(intent.character)?.name ?? intent.character;
				void store.goToTerminal(intent.character).then((result) => {
					if (result.ok) say(`You go to ${name}'s terminal.`);
					else {
						say(result.reason);
						view.notify(result.reason);
					}
				});
			}),
		[store, view, say],
	);

	const intend = (intent: WorldIntent) => view.intend(intent);
	const act = (action: CharacterAction, character: Character) => {
		if (action === "go-to") say(`You head to ${character.name}.`);
		if (action === "talk-to") say(`You talk to ${character.name}.`);
		if (action === "end-session") {
			say(`You ask ${character.name} to end its session.`);
			void placeActions.endSession(character);
			return;
		}
		intend({ kind: action, character: character.id });
	};
	const travel = (place: PlaceRef) => {
		if (placeKey(place) === state.minimap?.place) return;
		say(`You travel to ${theName(placeName(place, world, state.labels))}.`);
		intend({ kind: "travel", place });
	};

	const lines = useMemo(() => {
		const runtime: ChatLine[] = feed.map((line) => ({ ...line, key: `feed:${line.seq}` }));
		return [...runtime, ...game].sort((a, b) => a.at - b.at);
	}, [feed, game]);

	const counts = orbCounts(world);
	const open = (next: Tab) => {
		if (next === tab && !folded) setFolded(true);
		else {
			setTab(next);
			setFolded(false);
		}
	};
	const examined = examining ? find(examining) : undefined;

	return (
		<div className="aw-interface">
			<div className="aw-top-right">
				<div className="aw-orbs">
					<button
						type="button"
						className="aw-orb aw-orb-need"
						aria-label={`Needs you: ${counts.needsYou}`}
						title="Needs you"
						onClick={() => {
							setTab("needs-you");
							setFolded(false);
						}}
					>
						<span className="aw-orb-glass">
							<span className="aw-num">{counts.needsYou}</span>
						</span>
						<span className="aw-orb-label">Needs you</span>
					</button>
					<button
						type="button"
						className="aw-orb aw-orb-work"
						aria-label={`Working: ${counts.working}`}
						title="Working"
						onClick={() => {
							setTab("agents");
							setFolded(false);
						}}
					>
						<span className="aw-orb-glass">
							<span className="aw-num">{counts.working}</span>
						</span>
						<span className="aw-orb-label">Working</span>
					</button>
					<div className="aw-orb aw-orb-slack" title="Slack joins with the town square">
						<span className="aw-orb-glass" />
						<span className="aw-orb-label">Slack</span>
					</div>
				</div>
				<Minimap map={state.minimap} world={world} onWalk={(place, at) => intend({ kind: "walk-to", place, at })} />
			</div>
			<SidePanel
				world={world}
				labels={state.labels}
				here={state.minimap?.place}
				tab={tab}
				folded={folded}
				onTab={open}
				selected={selected}
				onSelect={setSelected}
				act={act}
				travel={travel}
				walkGrid={state.walkGrid ?? false}
				onWalkGrid={(shown) => intend({ kind: "walk-grid", shown })}
				avatarLooks={state.avatarLooks ?? []}
				avatarLook={world?.avatarLook}
				onAvatarLook={(choice) => {
					say(`You now look like the ${choice.label.toLowerCase()}.`);
					void store.setAvatarLook(choice.look).then((result) => {
						if (result.ok) return;
						say(result.reason);
						view.notify(result.reason);
					});
				}}
			/>
			<Chatbox
				lines={lines}
				hidden={hidden}
				onToggle={(kind) =>
					setHidden((now) => {
						const next = new Set(now);
						if (!next.delete(kind)) next.add(kind);
						return next;
					})
				}
				onAll={() => setHidden(new Set())}
				folded={chatFolded}
				onFold={() => setChatFolded((now) => !now)}
				awake={(id) => !!find(id)}
				onName={(id) => intend({ kind: "examine", character: id })}
			/>
			{examined && (
				<CharacterCard
					character={examined}
					world={world}
					labels={state.labels}
					act={act}
					onClose={() => setExamining(undefined)}
				/>
			)}
		</div>
	);
}
