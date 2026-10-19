// The tabbed side panel at the bottom right, as in Old School RuneScape: everyone by place, who needs you, work by
// ledger task, every place to travel to, and settings. Clicking the open tab folds the panel down to its tabs.
import { type ReactNode, useSyncExternalStore } from "react";
import type { Character, PlaceRef, WorldSnapshot } from "../../../src/world.js";
import { isOutside, placeKey } from "../../../src/world.js";
import type { AvatarLook } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import type { ThemeOption } from "../../view-state.js";
import { AtlassianSettings } from "../places/atlassian-settings.js";
import { forge } from "../places/forge-state.js";
import { MailList } from "../places/mail-list.js";
import { placePanels } from "../places/place-panels.js";
import { SlackIcon, SlackSettings, SlackTab } from "../places/slack-tab.js";
import { AgentsIcon, BellIcon, ChevronIcon, CogIcon, LetterIcon, ScrollIcon, SignpostIcon } from "./icons.js";
import { activity, byPlace, byTask, type Group, needsYou, OUTSIDE, orbCounts, placeName, placesOf } from "./model.js";
import { type CharacterAction, CharacterRow } from "./rows.js";

export type Tab = "agents" | "needs-you" | "work" | "mail" | "slack" | "places" | "settings";

const TABS: { tab: Tab; title: string; icon: ReactNode }[] = [
	{ tab: "agents", title: "Agents", icon: <AgentsIcon /> },
	{ tab: "needs-you", title: "Needs you", icon: <BellIcon /> },
	{ tab: "work", title: "Work", icon: <ScrollIcon /> },
	{ tab: "mail", title: "Mail", icon: <LetterIcon /> },
	{ tab: "slack", title: "Slack", icon: <SlackIcon /> },
	{ tab: "places", title: "Places", icon: <SignpostIcon /> },
	{ tab: "settings", title: "Settings", icon: <CogIcon /> },
];

/** Every function place the world will have: those not open yet are listed so the operator knows they are coming. */
const FUNCTION_PLACES = ["forge", "quest-office", "library", "inn", "rookery"];

export interface SidePanelProps {
	world: WorldSnapshot | undefined;
	labels: Record<string, string> | undefined;
	here: string | undefined;
	tab: Tab;
	folded: boolean;
	onTab: (tab: Tab) => void;
	/** Fold the panel down to its tabs; a tab opens it again. */
	onFold: () => void;
	selected: string | undefined;
	onSelect: (id: string | undefined) => void;
	act: (action: CharacterAction, character: Character) => void;
	travel: (place: PlaceRef) => void;
	walkGrid: boolean;
	onWalkGrid: (shown: boolean) => void;
	/** The theme's avatar looks, the one the snapshot says the operator chose, and choosing another. */
	avatarLooks: AvatarLook[];
	avatarLook: string | null | undefined;
	onAvatarLook: (look: AvatarLook) => void;
	/** The themes to choose from, the one worn, and wearing another. */
	themes: ThemeOption[];
	theme: string | undefined;
	onTheme: (id: string) => void;
}

export function SidePanel(props: SidePanelProps) {
	const { tab, folded, onTab, onFold, world } = props;
	const title = TABS.find((t) => t.tab === tab)!.title;
	const { needsYou: waiting } = orbCounts(world);
	return (
		<aside className={`aw-frame aw-side${folded ? " aw-folded" : ""}`} aria-label="Side panel">
			{!folded && (
				<>
					<header className="aw-panel-head">
						<h2>{title}</h2>
						<button
							type="button"
							className="aw-fold aw-panel-fold"
							aria-label="Fold the side panel"
							title="Fold the side panel to its tabs"
							onClick={onFold}
						>
							<ChevronIcon open />
						</button>
					</header>
					<div className="aw-panel-body aw-surface" role="tabpanel" aria-label={title}>
						<TabBody {...props} />
					</div>
				</>
			)}
			<div className="aw-tabs" role="tablist" aria-label="Side panel tabs">
				{TABS.map(({ tab: key, title: name, icon }) => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={key === tab}
						aria-label={name}
						title={folded ? `Open ${name}` : key !== tab ? name : `${name} (click to fold)`}
						className="aw-tab"
						onClick={() => onTab(key)}
					>
						{icon}
						{key === "needs-you" && waiting > 0 && (
							<span className="aw-badge" aria-hidden="true">
								<span>{waiting}</span>
							</span>
						)}
					</button>
				))}
			</div>
		</aside>
	);
}

function TabBody(props: SidePanelProps) {
	const { world, labels, tab } = props;
	if (tab === "places") return <Places {...props} />;
	if (tab === "settings") return <Settings {...props} />;
	if (tab === "mail") return <Mail {...props} />;
	if (tab === "slack") return <SlackTab />;
	if (!world?.characters.length) return <p className="aw-empty">Nobody is awake.</p>;
	if (tab === "agents") return <Groups {...props} groups={byPlace(world, labels)} detail={activity} />;
	if (tab === "work")
		return (
			<Groups {...props} groups={byTask(world)} detail={(character) => placeName(character.place, world, labels)} />
		);
	const groups = needsYou(world);
	if (!groups.length) return <p className="aw-empty">Nobody needs you.</p>;
	return (
		<Groups
			{...props}
			groups={groups}
			detail={(character) =>
				character.facts?.status === "asking" ? activity(character) : placeName(character.place, world, labels)
			}
			since={(character) => character.facts?.needsYouSince}
		/>
	);
}

function Groups({
	groups,
	detail,
	since,
	selected,
	onSelect,
	act,
}: SidePanelProps & {
	groups: Group[];
	detail: (character: Character) => string;
	since?: (character: Character) => number | null | undefined;
}) {
	return (
		<>
			{groups.map((group) => (
				<section key={group.key} aria-label={group.title}>
					<h3>
						<span>{group.title}</span>
						{group.detail && <small>{group.detail}</small>}
					</h3>
					<ul>
						{group.characters.map((character) => (
							<CharacterRow
								key={character.id}
								character={character}
								detail={detail(character)}
								since={since?.(character)}
								selected={selected === character.id}
								onSelect={() => onSelect(selected === character.id ? undefined : character.id)}
								act={act}
							/>
						))}
					</ul>
				</section>
			))}
		</>
	);
}

/** The Mail tab: the rookery's traffic, newest first, and a letter to write from anywhere. */
function Mail({ world }: SidePanelProps) {
	const mail = world?.mail ?? [];
	const theme = useTheme();
	return (
		<section aria-label="Mail">
			<h3 className="aw-mail-head">
				<span>Recent mail</span>
				<button
					type="button"
					className="aw-button aw-mail-write"
					onClick={() => placePanels.open("rookery", { write: true })}
				>
					{say(theme, "write-letter")}
				</button>
			</h3>
			{mail.length ? <MailList mail={mail} label="Recent mail" compact /> : <p className="aw-empty">No mail yet.</p>}
		</section>
	);
}

function Places({ world, labels, here, travel }: SidePanelProps) {
	const forgeList = useSyncExternalStore(forge.subscribe, forge.get).list;
	const theme = useTheme();
	const places = placesOf(world);
	const sections: { key: string; title: string; places: PlaceRef[] }[] = [
		...(world?.headquarters ?? []).map((hq) => ({
			key: hq.id,
			title: `${hq.name}'s headquarters`,
			places: places.filter((ref) => !isOutside(ref) && ref.headquarters === hq.id),
		})),
		{ key: "outside", title: "Outside", places: OUTSIDE },
	];
	// Open places are listed above, wherever they are; only the rest wait under "Not open yet".
	const open = new Set(places.map((ref) => ref.kind));
	const notOpen = FUNCTION_PLACES.filter((kind) => !open.has(kind as PlaceRef["kind"]));
	const count = (ref: PlaceRef) => world?.characters.filter((c) => placeKey(c.place) === placeKey(ref)).length ?? 0;
	const detail = (ref: PlaceRef) => {
		if (placeKey(ref) === here) return "You are here";
		if (ref.kind === "inn") {
			const asleep = world?.dormant?.length ?? 0;
			return asleep ? say(theme, "asleep-count", { count: asleep }) : say(theme, "nobody-asleep");
		}
		if (ref.kind === "forge") {
			const open = forgeList.pullRequests.length;
			const failing = forgeList.pullRequests.filter((pr) => pr.ci === "failing").length;
			if (!open) return "";
			return `${open} open pull ${open === 1 ? "request" : "requests"}${failing ? `, ${failing} failing` : ""}`;
		}
		if (ref.kind === "rookery") {
			const waiting = world?.mail?.filter((item) => item.state === "waiting").length ?? 0;
			return waiting ? say(theme, waiting === 1 ? "letter-waits" : "letters-wait", { count: waiting }) : "";
		}
		if (ref.kind === "wing") {
			const wing = world?.headquarters
				.find((hq) => hq.id === ref.headquarters)
				?.wings.find((w) => w.repository === ref.repository);
			if (wing?.headcount === 0) return "Closed up";
		}
		const n = count(ref);
		return n ? `${n} ${n === 1 ? "agent" : "agents"}` : "";
	};
	return (
		<>
			{sections.map((section) => (
				<section key={section.key} aria-label={section.title}>
					<h3>
						<span>{section.title}</span>
					</h3>
					<ul>
						{section.places.map((ref) => {
							const key = placeKey(ref);
							return (
								<li key={key} className={`aw-row aw-place${key === here ? " aw-row-here" : ""}`}>
									<button
										type="button"
										className="aw-row-main"
										title={`Travel to ${placeName(ref, world, labels)}`}
										onClick={() => travel(ref)}
									>
										<span className="aw-pip aw-pip-place" aria-hidden="true" />
										<span className="aw-row-text">
											<span className="aw-row-name">{placeName(ref, world, labels)}</span>
											<span className="aw-row-detail">{detail(ref)}</span>
										</span>
										<span className="aw-row-go" aria-hidden="true">
											Travel
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
			{notOpen.length > 0 && (
				<section aria-label="Not open yet">
					<h3>
						<span>Not open yet</span>
					</h3>
					<ul>
						{notOpen.map((kind) => (
							<li key={kind} className="aw-row aw-place aw-row-muted">
								<div className="aw-row-main">
									<span className="aw-pip aw-pip-place" aria-hidden="true" />
									<span className="aw-row-text">
										<span className="aw-row-name">{labels?.[kind] ?? kind}</span>
									</span>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}

function Settings({
	walkGrid,
	onWalkGrid,
	avatarLooks,
	avatarLook,
	onAvatarLook,
	themes,
	theme,
	onTheme,
}: SidePanelProps) {
	const worn = avatarLooks.find(({ look }) => look === avatarLook)?.look ?? avatarLooks[0]?.look;
	return (
		<div className="aw-settings">
			<section aria-label="The world">
				<h3>
					<span>The world</span>
				</h3>
				<button
					type="button"
					role="switch"
					aria-checked={walkGrid}
					className="aw-switch-row"
					onClick={() => onWalkGrid(!walkGrid)}
				>
					<span className="aw-switch-text">
						<span>Walk grid</span>
						<small className="aw-switch-hint">Blocked cells, spots, and doors over the painting (G)</small>
					</span>
					<span className="aw-switch" aria-hidden="true">
						<i />
					</span>
				</button>
			</section>
			<section aria-label="Look">
				<h3>
					<span>Look</span>
				</h3>
				<fieldset className="aw-themes">
					<legend className="aw-setting">Theme</legend>
					{themes.map((choice) => (
						<label
							key={choice.id}
							className={`aw-theme${choice.broken ? " aw-theme-broken" : ""}`}
							title={choice.broken ? `Its pack is broken: ${choice.broken}` : undefined}
						>
							<input
								type="radio"
								name="aw-theme"
								value={choice.id}
								checked={choice.id === theme}
								disabled={!!choice.broken}
								onChange={() => onTheme(choice.id)}
							/>
							<span className="aw-theme-mark" aria-hidden="true" />
							<span className="aw-theme-text">
								<span className="aw-theme-name">{choice.name}</span>
								{(choice.broken ?? choice.description) && (
									<small className="aw-theme-line">
										{choice.broken ? `Broken: ${choice.broken}` : choice.description}
									</small>
								)}
							</span>
						</label>
					))}
				</fieldset>
				<fieldset className="aw-looks">
					<legend className="aw-setting">Avatar look</legend>
					{avatarLooks.map((choice) => (
						<label
							key={choice.look}
							className="aw-look"
							title={
								choice.look === worn
									? `You look like the ${choice.label.toLowerCase()}`
									: `Look like the ${choice.label.toLowerCase()}`
							}
						>
							<input
								type="radio"
								name="aw-avatar-look"
								value={choice.look}
								checked={choice.look === worn}
								onChange={() => onAvatarLook(choice)}
							/>
							<span className="aw-look-frame">
								<img src={choice.portrait} alt="" draggable={false} />
							</span>
							<span className="aw-look-name">{choice.label}</span>
						</label>
					))}
				</fieldset>
			</section>
			<AtlassianSettings />
			<SlackSettings />
			<section aria-label="Controls">
				<h3>
					<span>Controls</span>
				</h3>
				<p className="aw-note">
					Left click walks or does the default action; right click lists every action; the wheel zooms. In this panel,
					choose a name for its actions.
				</p>
			</section>
		</div>
	);
}
