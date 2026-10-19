// PROTOTYPE: the RuneScape-style interface around the world: a minimap with orbs (top right), a tabbed side panel
// (bottom right) from which everything is a click away, and a chatbox of world events (bottom left). Walking is for
// immersion; every action here works from anywhere.
import { openMenu } from "./ui.js";

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TABS = [
	["agents", "\u263a", "Agents"],
	["attention", "!", "Needs you"],
	["work", "\u25c6", "Work"],
	["mail", "\u2709", "Mail"],
	["slack", "#", "Slack"],
	["places", "\u2302", "Places"],
	["settings", "\u2699", "Settings"],
];
const MAIL = [
	{ from: "Invoice retries", to: "Orla", text: "Retries pass locally; opening a pull request." },
	{ from: "Orla", to: "Ingest backfill", text: "Pause the backfill until the incident clears." },
	{ from: "Docs sweep", to: "Orla", text: "Done: two pages updated." },
];

let app;
let hooks;
let tab = "agents";
let chatFilter = "all";
const chat = [];

const state = (s) => (s.channel ? "channel" : !s.awake ? "dormant" : s.status === "waiting" ? "waiting" : s.needsYou ? "done" : s.status === "busy" ? "busy" : "idle");
const GLYPH = { waiting: "?", done: "\u2713", busy: "\u2026", idle: "\u00b7", dormant: "z", channel: "#" };

/** Every character the operator can act on, with where it lives. */
function everyone() {
	const w = app.world;
	const rows = [];
	if (w.coordinator) rows.push({ s: w.coordinator, place: ["hall", "start", {}], where: "Guild hall" });
	for (const wing of w.wings) for (const s of wing.agents) rows.push({ s, place: ["wing", "gallery", { repo: wing.repo }], where: `${wing.repo} wing` });
	for (const s of w.common) rows.push({ s, place: ["hall", "start", {}], where: "Common room" });
	for (const s of w.independent) rows.push({ s, place: ["square", "hall", {}], where: "Village square" });
	for (const s of w.dormant) rows.push({ s, place: null, where: "Inn (asleep)" });
	return rows;
}

function row(r) {
	const st = state(r.s);
	return `<div class="ui-row" data-id="${esc(r.s.id)}"><span class="st ${st}">${GLYPH[st]}</span><span class="nm">${esc(r.s.name)}</span><span class="wh">${esc(r.where)}</span></div>`;
}

function renderTab() {
	const body = document.getElementById("tab-body");
	const rows = everyone();
	const groups = (list, by) => {
		const out = new Map();
		for (const r of list) out.set(by(r), [...(out.get(by(r)) ?? []), r]);
		return [...out].map(([title, rs]) => `<div class="ui-group">${esc(title)}</div>${rs.map(row).join("")}`).join("");
	};
	if (tab === "agents") body.innerHTML = groups(rows, (r) => r.where);
	else if (tab === "attention") {
		const need = rows.filter((r) => ["waiting", "done"].includes(state(r.s))).sort((a, b) => (state(a.s) === "waiting" ? 0 : 1) - (state(b.s) === "waiting" ? 0 : 1));
		body.innerHTML = need.length ? need.map(row).join("") : `<div class="ui-empty">Nobody needs you.</div>`;
	} else if (tab === "work") {
		const tasks = rows.filter((r) => r.s.awake);
		body.innerHTML = groups(tasks, (r) => r.s.task ?? (r.s.repository ? `${r.s.repository} (no ledger task)` : "No task"));
	} else if (tab === "mail") body.innerHTML = MAIL.map((m) => `<div class="ui-mail"><b>${esc(m.from)}</b> \u2192 <b>${esc(m.to)}</b><div>${esc(m.text)}</div></div>`).join("");
	else if (tab === "slack")
		body.innerHTML = app.world.channels.map((c) => `<div class="ui-row" data-id="${esc(c.id)}"><span class="st channel">#</span><span class="nm">${esc(c.name.slice(1))}</span><span class="wh">${c.unread ? `<b class="unread">${c.unread}</b>` : ""}</span></div>`).join("");
	else if (tab === "places") {
		const places = [["Guild hall", "hall", "start", {}], ["Gallery of wings", "gallery", "hall", {}], ...app.world.wings.map((w) => [`${w.repo} wing`, "wing", "gallery", { repo: w.repo }]), ["Village square", "square", "hall", {}]];
		const later = ["Forge", "Library", "Quest office", "Inn", "Rookery"];
		body.innerHTML = `${places.map(([name, key, entry, extra], i) => `<div class="ui-row place" data-place="${i}"><span class="st idle">\u2302</span><span class="nm">${esc(name)}</span><span class="wh">travel</span></div>`).join("")}${later.map((n) => `<div class="ui-row muted"><span class="st dormant">\u2302</span><span class="nm">${n}</span><span class="wh">not built</span></div>`).join("")}`;
		body.querySelectorAll("[data-place]").forEach((el) => {
			el.onclick = () => {
				const [name, key, entry, extra] = places[Number(el.dataset.place)];
				log("game", `You travel to ${name}.`);
				hooks.scene()?.go(key, entry, extra);
			};
		});
	} else if (tab === "settings") body.innerHTML = document.getElementById("settings-template").innerHTML;
	body.querySelectorAll(".ui-row[data-id]").forEach((el) => {
		const r = rows.find((x) => x.s.id === el.dataset.id) ?? { s: app.world.channels.find((c) => c.id === el.dataset.id), place: ["square", "hall", {}] };
		el.onclick = () => act(r, "talk");
		el.oncontextmenu = (event) => {
			event.preventDefault();
			const actions = [
				{ verb: "Talk-to", target: r.s.name, kind: "npc", run: () => act(r, "talk") },
				...(r.place ? [{ verb: "Go-to", target: r.s.name, kind: "npc", run: () => act(r, "goto") }] : []),
				{ verb: "Examine", target: r.s.name, kind: "npc", run: () => act(r, "examine") },
				...(r.s.channel ? [] : [{ verb: "Terminal", target: r.s.name, kind: "npc", run: () => act(r, "terminal") }]),
			];
			openMenu(event.clientX, event.clientY, actions);
		};
	});
}

function act(r, verb) {
	const scene = hooks.scene();
	if (!scene) return;
	if (verb === "goto" && r.place) {
		const [key, entry, extra] = r.place;
		log("game", `You head to ${r.s.name}.`);
		if (scene.scene.key === key && JSON.stringify(scene.enterData?.repo ?? null) === JSON.stringify(extra.repo ?? null)) scene.walkToPerson(r.s);
		else scene.go(key, entry, { ...extra, seek: r.s.id });
		return;
	}
	if (verb === "examine") return scene.examine(r.s);
	if (verb === "terminal") return scene.note(`Would switch tmux to ${r.s.name}'s pane (prototype: not wired).`);
	scene.talk(r.s);
}

function renderOrbs() {
	const rows = everyone().map((r) => state(r.s));
	const unread = app.world.channels.reduce((n, c) => n + (c.unread ?? 0), 0);
	document.getElementById("orb-need").textContent = rows.filter((s) => s === "waiting" || s === "done").length;
	document.getElementById("orb-busy").textContent = rows.filter((s) => s === "busy").length;
	document.getElementById("orb-unread").textContent = unread;
}

function renderChat() {
	const el = document.getElementById("chat-log");
	el.innerHTML = chat
		.filter((c) => chatFilter === "all" || c.kind === chatFilter)
		.slice(-60)
		.map((c) => `<div class="cl ${c.kind}"><span class="t">${c.time}</span> ${esc(c.text)}</div>`)
		.join("");
	el.scrollTop = el.scrollHeight;
}

/** A line in the chatbox: kinds are game, agents, mail, slack. */
export function log(kind, text) {
	const d = new Date();
	chat.push({ kind, text, time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` });
	renderChat();
}

export function refreshInterface() {
	if (!app) return;
	renderTab();
	renderOrbs();
}

export function initInterface(theApp, theHooks) {
	app = theApp;
	hooks = theHooks;
	const tabs = document.getElementById("tabs");
	tabs.innerHTML = TABS.map(([key, icon, title]) => `<button data-tab="${key}" title="${title}" class="${key === tab ? "on" : ""}">${icon}</button>`).join("");
	tabs.onclick = (event) => {
		const key = event.target.closest("[data-tab]")?.dataset.tab;
		if (!key) return;
		tab = key;
		tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === key));
		document.getElementById("tab-title").textContent = TABS.find((t) => t[0] === key)[2];
		renderTab();
	};
	document.getElementById("tab-title").textContent = TABS[0][2];
	document.getElementById("chat-tabs").onclick = (event) => {
		const f = event.target.closest("[data-filter]")?.dataset.filter;
		if (!f) return;
		chatFilter = f;
		document.querySelectorAll("#chat-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.filter === f));
		renderChat();
	};
	for (const [id, key] of [["orb-need", "attention"], ["orb-busy", "agents"], ["orb-unread", "slack"]])
		document.getElementById(id).parentElement.onclick = () => tabs.querySelector(`[data-tab=${key}]`).click();
	log("game", "Welcome to the guild.");
	// World events, as the runtime's event stream would feed them (seed lines in this prototype).
	const seed = [
		["agents", "Session state ran bash: npx vitest run components/session-state."],
		["slack", "#incidents: pagerbot posted a new alert."],
		["mail", "Invoice retries mailed Orla."],
		["agents", "Ingest backfill settled."],
		["slack", "#eng-data: Priya replied in a thread."],
	];
	let i = 0;
	setInterval(() => {
		const [kind, text] = seed[i++ % seed.length];
		log(kind, text);
	}, 9000);
	refreshInterface();
}
