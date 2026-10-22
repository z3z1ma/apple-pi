// The tabbed side panel at the bottom right, as in Old School RuneScape: everyone by place, who needs you, work by
// ledger task, every place to travel to, and settings. Clicking the open tab folds the panel down to its tabs.
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import type { JiraIssue, PullRequest, RecentPage } from "../../../src/integrations.js";
import { TAB_ICONS } from "../../../src/theme-pack.js";
import type { Character, PlaceRef, WorldSnapshot } from "../../../src/world.js";
import { isOutside, placeKey } from "../../../src/world.js";
import type { AvatarLook } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import type { ThemeOption } from "../../view-state.js";
import { AtlassianSettings } from "../places/atlassian-settings.js";
import { atlassian, type Reading, urgent } from "../places/atlassian-state.js";
import { forge } from "../places/forge-state.js";
import { MailList } from "../places/mail-list.js";
import { OperatorInbox } from "../places/operator-inbox.js";
import { placePanels } from "../places/place-panels.js";
import { SlackIcon, SlackSettings, SlackTab } from "../places/slack-tab.js";
import { AgentsIcon, BellIcon, ChecklistIcon, ChevronIcon, CogIcon, LetterIcon, MapIcon } from "./icons.js";
import {
	activity,
	byPlace,
	byTask,
	type Group,
	needsYou,
	OUTSIDE,
	orbCounts,
	placeName,
	placesOf,
	workLine,
} from "./model.js";
import { type CharacterAction, CharacterRow } from "./rows.js";

export type Tab = "agents" | "needs-you" | "work" | "mail" | "slack" | "places" | "settings";

const TABS: { tab: Tab; title: string; icon: ReactNode }[] = [
	{ tab: "agents", title: "Agents", icon: <AgentsIcon /> },
	{ tab: "needs-you", title: "Needs you", icon: <BellIcon /> },
	{ tab: "work", title: "Work", icon: <ChecklistIcon /> },
	{ tab: "mail", title: "Mail", icon: <LetterIcon /> },
	{ tab: "slack", title: "Slack", icon: <SlackIcon /> },
	{ tab: "places", title: "Places", icon: <MapIcon /> },
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
	const unreadMail = world?.operatorMail?.filter((thread) => thread.unread > 0).length ?? 0;
	const theme = useTheme();
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
						data-tab={key}
						onClick={() => onTab(key)}
					>
						<TabIcon tab={key} pack={theme?.style[`--aw-icon-${key}`]} fallback={icon} />
						{key === "mail" && unreadMail > 0 && (
							<span className="aw-badge" role="status" aria-label={`${unreadMail} conversations need you`}>
								<span>{unreadMail}</span>
							</span>
						)}
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

/**
 * A tab's icon: the pack's own drawing when its manifest names one (`--aw-icon-<tab>`, an SVG drawn in the tab's ink
 * through a mask, so the skin's colours still apply), else the world's own.
 */
function TabIcon({ tab, pack, fallback }: { tab: Tab; pack: string | undefined; fallback: ReactNode }) {
	if (!pack || !(TAB_ICONS as readonly string[]).includes(tab)) return <>{fallback}</>;
	return (
		<span
			className="aw-tab-icon"
			data-icon={tab}
			aria-hidden="true"
			style={{ maskImage: pack, WebkitMaskImage: pack }}
		/>
	);
}

function TabBody(props: SidePanelProps) {
	const { world, labels, tab } = props;
	if (tab === "places") return <Places {...props} />;
	if (tab === "settings") return <Settings {...props} />;
	if (tab === "mail") return <Mail {...props} />;
	if (tab === "slack") return <SlackTab />;
	if (!world?.characters.length) return <p className="aw-empty">Nobody is awake.</p>;
	if (tab === "agents") return <Groups {...props} groups={byPlace(world, labels)} detail={activity} work={workLine} />;
	if (tab === "work")
		return (
			<Groups
				{...props}
				groups={byTask(world)}
				// Those with no ledger task say what they work on instead of where they are.
				detail={(character) =>
					(!character.facts?.task && character.facts?.intent) || placeName(character.place, world, labels)
				}
			/>
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
	work,
	since,
	selected,
	onSelect,
	act,
}: SidePanelProps & {
	groups: Group[];
	detail: (character: Character) => string;
	work?: (character: Character) => string;
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
								work={work?.(character)}
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
			<OperatorInbox threads={world?.operatorMail ?? []} />
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

/** The forge's line in the Places tab: its open pull requests, and how many fail. Each line fits the tab's width. */
function forgeDetail(pullRequests: PullRequest[]): string {
	const open = pullRequests.length;
	const failing = pullRequests.filter((pr) => pr.ci === "failing").length;
	if (!open) return "";
	return `${open} pull ${open === 1 ? "request" : "requests"}${failing ? `, ${failing} failing` : ""}`;
}

/** The quest office's: the open issues assigned to the operator, and how many are pressing; nothing until read. */
function questDetail(assigned: Reading<JiraIssue[]>): string {
	if (!("items" in assigned) || !assigned.items) return "";
	const open = assigned.items.filter((issue) => issue.statusCategory !== "done");
	const pressing = open.filter(urgent).length;
	if (!open.length) return "Nothing assigned to you";
	return pressing ? `${open.length} assigned, ${pressing} pressing` : `${open.length} assigned to you`;
}

/** The library's: the pages read there lately. */
function libraryDetail(recent: Reading<RecentPage[]>): string {
	const read = "items" in recent ? (recent.items?.length ?? 0) : 0;
	return read ? `${read} ${read === 1 ? "page" : "pages"} read lately` : "";
}

function Places({ world, labels, here, travel }: SidePanelProps) {
	const forgeList = useSyncExternalStore(forge.subscribe, forge.get).list;
	const { assigned, recent, signedIn } = useSyncExternalStore(atlassian.subscribe, atlassian.get);
	const theme = useTheme();
	// The quest office's and the library's counts are cheap to read (one Jira query, the local list of pages read), so
	// the tab reads them when it opens if nothing has yet; the forge's list costs a `gh` call per pull request and is
	// counted once the forge has read it.
	useEffect(() => {
		if (signedIn && atlassian.get().assigned.state === "idle") void atlassian.loadAssigned();
		if (atlassian.get().recent.state === "idle") void atlassian.loadRecent();
	}, [signedIn]);
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
		if (ref.kind === "forge") return forgeDetail(forgeList.pullRequests);
		if (ref.kind === "quest-office") return questDetail(assigned);
		if (ref.kind === "library") return libraryDetail(recent);
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
