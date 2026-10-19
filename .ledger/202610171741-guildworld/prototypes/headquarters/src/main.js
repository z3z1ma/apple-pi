// PROTOTYPE: boot the headquarters prototype: load art, build the world from seed or live.json, start in the hall.
import { makeCharacterAnims, PlaceScene } from "./place.js";
import { gallery, hall, square, T, wing } from "./places.js";
import { derive, loadRemembered, saveRemembered, SEED, SEED_REMEMBERED } from "./world.js";

const CHARS = await fetch("assets/chars/manifest.json").then((r) => r.json());
const SCENES = ["hall", "gallery", "wing-small", "wing-large", "square"];
const IMAGES = [...SCENES, "door-closed", "door-open", "door-boarded", "banner-cream", "banner-red"];

class Boot extends Phaser.Scene {
	constructor() {
		super("boot");
	}
	preload() {
		for (const name of IMAGES) this.load.image(name, `${SCENES.includes(name) ? "raw-art" : "assets"}/${name}.png`);
		this.load.spritesheet("cat", "assets/cat.png", { frameWidth: 41, frameHeight: 58 });
		for (const [name, { frame }] of Object.entries(CHARS)) this.load.spritesheet(name, `assets/chars/${name}.png`, { frameWidth: frame[0], frameHeight: frame[1] });
	}
	create() {
		makeCharacterAnims(this, Object.keys(CHARS));
		this.scene.start("hall", { entry: "start" });
	}
}

const app = {
	sessions: structuredClone(SEED),
	source: "seed",
	remembered: loadRemembered(SEED_REMEMBERED),
	avatarLook: "avatar",
	chars: CHARS,
	movement: "smooth",
	zoom: Math.max(1, Math.min(2.4, innerHeight / (13 * T))),
	world: null,
};

function recompute() {
	app.world = derive(app.sessions, app.remembered);
	app.remembered = app.world.remembered;
	saveRemembered(app.remembered);
	renderControls();
}

function restart() {
	recompute();
	const active = game.scene.getScenes(true).find((s) => s instanceof PlaceScene);
	if (active) active.scene.restart({ entry: active.entry, ...active.enterData });
}

function renderControls() {
	const w = app.world;
	document.getElementById("state").innerHTML = `
		<div><b>source</b> ${app.source} · <b>coordinator</b> ${w.coordinator?.name ?? "none"}</div>
		<div><b>wings</b> ${w.wings.map((x) => `${x.repo} (${x.agents.length})`).join(", ") || "none"}</div>
		<div><b>common room</b> ${w.common.map((s) => s.name).join(", ") || "nobody"}</div>
		<div><b>dormant</b> ${w.dormant.map((s) => s.name).join(", ") || "nobody"} · <b>outside</b> ${w.independent.map((s) => s.name).join(", ") || "nobody"}</div>`;
}

let counter = 0;
const actions = {
	seed: () => {
		app.sessions = structuredClone(SEED);
		app.source = "seed";
		restart();
	},
	live: async () => {
		const live = await fetch("live.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		if (!live) return alert("No live.json: run python3 snapshot.py first.");
		app.sessions = live.sessions;
		app.source = "live.json";
		restart();
	},
	agent: () => {
		const repos = ["apple-pi", "billing-service", "data-pipeline", "web-app", "infra"];
		const repo = repos[Math.floor(Math.random() * repos.length)];
		const status = ["busy", "idle", "waiting"][counter % 3];
		app.sessions.push({ id: `x${++counter}`, name: `Worker ${counter}`, reportsTo: app.world.coordinator?.id, awake: true, status, repository: repo, tool: status === "busy" ? "bash" : null });
		restart();
	},
	wing: () => {
		app.remembered.push(`project-${++counter}`);
		restart();
	},
	movement: () => {
		app.movement = app.movement === "smooth" ? "tiles" : "smooth";
		document.getElementById("movement").textContent = `Movement: ${app.movement}`;
	},
	grid: () => {
		app.showGrid = !app.showGrid;
		restart();
	},
	forget: () => {
		app.remembered = [];
		restart();
	},
};
document.getElementById("controls").addEventListener("click", (event) => {
	const name = event.target.dataset?.act;
	if (name) actions[name]();
});
document.getElementById("toggle").onclick = () => document.getElementById("controls").classList.toggle("closed");

// The game menu replaces the browser's everywhere, including over the HTML chrome drawn on the canvas.
document.addEventListener("contextmenu", (event) => event.preventDefault());

recompute();
const scenes = [new Boot(), new PlaceScene("hall", hall), new PlaceScene("gallery", gallery), new PlaceScene("wing", wing), new PlaceScene("square", square)];
const game = new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#140e18",
	pixelArt: false,
	antialias: true,
	scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight },
	scene: scenes,
});
game.registry.set("app", app);
window.__hq = { game, app }; // for headless checks
