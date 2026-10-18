// PROTOTYPE: page glue. Starts the Phaser town, renders the HUD, inspector, and prototype controls.
import { clearMemory } from "./layout.js";
import { TownScene } from "./scene.js";
import { fromLive, newSession, nextStatus, seedState } from "./state.js";

let state = seedState();
let source = "mock";
let picked = "";
const scene = new TownScene();
new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#1d1a2b",
	pixelArt: true,
	roundPixels: true,
	scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight },
	input: { windowEvents: false },
	scene: [scene],
});
window.town = scene;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ICON = { busy: '<i class="ic busy"></i>', waiting: '<i class="ic waiting"></i>', idle: '<i class="ic idle"></i>' };
const NAMES = ["Dashboards", "Infra", "Research", "Billing", "Docs", "Mobile", "DataLake", "Search", "Payments", "Website"];

function push() {
	scene.apply(structuredClone(state));
	renderHud();
	renderControls();
}

function renderHud() {
	const count = (st) => state.sessions.filter((s) => s.status === st).length;
	$("hud").innerHTML = `<b>Agent World</b><span class="src">${source === "live" ? "live snapshot" : "mock state"}</span>
		<span title="needs you">${ICON.waiting} ${count("waiting")} need you</span>
		<span>${ICON.busy} ${count("busy")} busy</span><span>${ICON.idle} ${count("idle")} idle</span>`;
}

function renderControls() {
	const coords = state.coordinators;
	if (!coords.includes(picked)) picked = coords[0] ?? "";
	const coordOpts = coords.map((c) => `<option${c === picked ? " selected" : ""}>${esc(c)}</option>`).join("");
	const rows = state.tmuxSessions
		.map((t) => {
			const sess = state.sessions.filter((s) => s.tmuxSession === t);
			const items = sess
				.map((s) => {
					const role = coords.includes(s.id) ? "coordinator" : coords.includes(s.reportsTo) ? `worker of ${s.reportsTo}` : "independent";
					return `<div class="sess"><button data-act="cycle" data-id="${esc(s.id)}" title="cycle status">${ICON[s.status]}</button><span class="nm">${esc(s.name)}</span><span class="role">${esc(role)}</span>
					${role === "independent" ? `<button data-act="coord" data-id="${esc(s.id)}" title="make coordinator">&#9733;</button>` : ""}${role === "coordinator" ? `<button data-act="uncoord" data-id="${esc(s.id)}" title="stop being coordinator">&#9734;</button>` : ""}
					<button data-act="rm" data-id="${esc(s.id)}" title="end session">&times;</button></div>`;
				})
				.join("");
			return `<div class="tmux"><div class="th"><b>${esc(t)}</b><span>
				<button data-act="add" data-t="${esc(t)}">+ session</button>
				${coords.length ? `<button data-act="addw" data-t="${esc(t)}">+ worker</button>` : ""}
				<button data-act="rmt" data-t="${esc(t)}" title="end tmux session">&times;</button></span></div>${items || '<div class="empty">no Pi sessions (dark building)</div>'}</div>`;
		})
		.join("");
	$("controls-body").innerHTML = `<div class="row"><button data-act="addt">+ tmux session</button>
		${coords.length ? `<label>workers report to <select id="coord-pick">${coordOpts}</select></label>` : ""}</div>${rows}
		<div class="row"><button data-act="light">evening / day</button><button data-act="live">load live.json</button>
		<button data-act="seed">reset state</button><button data-act="forget">forget lots</button></div>`;
}

$("controls-body").addEventListener("click", async (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	const { act, id, t } = b.dataset;
	if (act === "addt") {
		const name = NAMES.find((n) => !state.tmuxSessions.includes(n)) ?? `tmux-${state.tmuxSessions.length}`;
		state.tmuxSessions.push(name);
		state.sessions.push(newSession(name, ""));
	}
	if (act === "add") state.sessions.push(newSession(t, ""));
	if (act === "addw" && picked) state.sessions.push(newSession(t, picked));
	if (act === "rmt") {
		state.tmuxSessions = state.tmuxSessions.filter((x) => x !== t);
		state.sessions = state.sessions.filter((s) => s.tmuxSession !== t);
	}
	if (act === "rm") state.sessions = state.sessions.filter((s) => s.id !== id);
	if (act === "cycle") {
		const s = state.sessions.find((x) => x.id === id);
		s.status = nextStatus(s.status);
	}
	if (act === "coord") state.coordinators.push(id);
	if (act === "uncoord") state.coordinators = state.coordinators.filter((c) => c !== id);
	if (act === "light") scene.setEvening(!scene.evening);
	if (act === "seed") {
		state = seedState();
		source = "mock";
	}
	if (act === "forget") {
		clearMemory();
		location.reload();
		return;
	}
	if (act === "live") {
		try {
			const live = await (await fetch(`live.json?${Date.now()}`)).json();
			state = fromLive(live, state.coordinators);
			source = "live";
		} catch {
			alert("No live.json: run ./snapshot.sh in this directory first.");
			return;
		}
	}
	push();
});

window.addEventListener("inspect", (e) => {
	const { session: s, place: p } = e.detail;
	const el = $("inspector");
	if (s) {
		const role = state.coordinators.includes(s.id) ? "Coordinator" : s.reportsTo ? `Worker of ${esc(s.reportsTo)}` : "Independent session";
		el.innerHTML = `<button class="x" onclick="this.parentElement.hidden=true">&times;</button><h2>${esc(s.name)}</h2><div class="sub">${role} · <code>${esc(s.id)}</code></div><dl>
			<dt>Status</dt><dd>${ICON[s.status]} ${esc(s.status)}</dd>
			<dt>Lives in</dt><dd>${esc(p?.title)}</dd>
			<dt>tmux session</dt><dd>${esc(s.tmuxSession)}</dd>
			<dt>Directory</dt><dd><code>${esc(s.cwd)}</code></dd>
			<dt>Work item</dt><dd>${esc(s.task) || "<i>no linked ledger task</i>"}</dd>
			<dt>Last tool</dt><dd>${s.tool ? `<code>${esc(s.tool)} ${esc(s.detail)}</code>` : "<i>unknown</i>"}</dd></dl>
			<p class="note">${source === "live" ? "Observed from the live snapshot." : "Mock values."} Walking and poses are decorative.</p>`;
	} else if (p) {
		const res = (p.residents ?? []).map((r) => `<li>${ICON[r.status]} ${esc(r.name)}</li>`).join("");
		const kind = { hq: "Coordinator headquarters", wing: "Headquarters wing", building: "Building", hub: "Hub" }[p.kind];
		el.innerHTML = `<button class="x" onclick="this.parentElement.hidden=true">&times;</button><h2>${esc(p.title)}</h2><div class="sub">${kind}${p.tmux ? ` · tmux <code>${esc(p.tmux)}</code>` : ""}${p.system ? ` · ${esc(p.system)}` : ""}</div>
			${p.kind === "hub" ? "<p>Hub contents (attached items and your queue) come later.</p>" : res ? `<ul>${res}</ul>` : "<p>No Pi sessions: the building is dark.</p>"}`;
	}
	el.hidden = false;
});

$("toggle").addEventListener("click", () => $("controls").classList.toggle("closed"));
addEventListener("keydown", (e) => {
	if (e.key === "Escape") $("inspector").hidden = true;
	if (e.key === "l" || e.key === "L") scene.setEvening(!scene.evening);
});
push();
$("controls-body").addEventListener("change", (e) => {
	if (e.target.id === "coord-pick") picked = e.target.value;
});
