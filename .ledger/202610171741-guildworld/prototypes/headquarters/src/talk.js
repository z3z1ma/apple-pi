// PROTOTYPE: the conversation panel that opens when you talk to a character (fantasy theme: a book). It shows the
// portrait, the Markdown transcript with folded tool calls, a reply streaming in, and actions by the agent's state.
// Seed data only; sending changes this page, not a Pi session.
import { CONVERSATIONS, QUESTIONNAIRES, STREAMING } from "./conversations.js";

const panel = document.getElementById("talk");
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Just enough Markdown for agent replies: code fences, inline code, bold, lists, paragraphs. */
function md(text) {
	const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
	const out = [];
	const blocks = text.split(/```/);
	blocks.forEach((block, i) => {
		if (i % 2) {
			out.push(`<pre><code>${esc(block.replace(/^\w*\n/, "").replace(/\n$/, ""))}</code></pre>`);
			return;
		}
		for (const para of block.split(/\n\s*\n/)) {
			const lines = para.split("\n").filter((l) => l.trim());
			if (!lines.length) continue;
			if (lines.every((l) => /^\s*(-|\d+\.)\s/.test(l))) {
				const tag = /^\s*\d+\./.test(lines[0]) ? "ol" : "ul";
				out.push(`<${tag}>${lines.map((l) => `<li>${inline(l.replace(/^\s*(-|\d+\.)\s/, ""))}</li>`).join("")}</${tag}>`);
			} else out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
		}
	});
	return out.join("");
}

const TOOL_VERB = { bash: "ran", edit: "edited", write: "wrote", read: "read", ledger: "checked" };

function entryHtml(e, name) {
	if (e.role === "tool")
		return `<details class="tool"><summary>${TOOL_VERB[e.name] ?? "used"} <code>${esc(e.arg)}</code></summary><div class="tool-body">${esc(e.name)} \u00b7 output is read from the transcript when opened (not in this prototype)</div></details>`;
	if (e.role === "note") return `<div class="note">${esc(e.text)}</div>`;
	return `<div class="entry ${e.role}"><div class="who">${e.role === "you" ? "You" : esc(name)}${e.tag ? ` <span class="tag">${esc(e.tag)}</span>` : ""}</div><div class="body">${md(e.text)}</div></div>`;
}

let streamTimer;

/** Open the panel for a session. `hooks.changed(session)` lets the scene redraw the character's badge. */
export function openTalk(session, portrait, hooks) {
	clearInterval(streamTimer);
	const s = session;
	const log = (CONVERSATIONS[s.id] ??= [{ role: "note", text: "No conversation yet in this prototype's seed data." }]);
	if (s.needsYou) {
		s.needsYou = false; // opening the conversation is seeing it
		hooks.changed(s);
	}
	const doing = s.status === "waiting" ? "Waiting for your answer" : s.status === "busy" ? (s.tool ? `Busy: ${s.tool}${s.toolArg ? ` ${s.toolArg}` : ""}` : "Thinking") : "Idle";
	panel.innerHTML = `
		<div class="book">
			<aside class="side">
				${portrait ? `<img class="portrait" src="${esc(portrait)}" alt="">` : ""}
				<h2>${esc(s.name)}</h2>
				<div class="meta">${esc(s.coordinator ? "Coordinator" : s.repository ? s.repository : "No repository")}${s.task ? `<br><span class="task">\u25c6 ${esc(s.task)}</span>` : ""}</div>
				<div class="doing ${s.status}">${esc(doing)}</div>
				<button class="side-btn" data-act="terminal">Go to its terminal</button>
			</aside>
			<section class="page">
				<button class="close" data-act="close" title="Close (Esc)">\u00d7</button>
				<div class="log"></div>
				<div class="act"></div>
			</section>
		</div>`;
	panel.hidden = false;
	const logEl = panel.querySelector(".log");
	const render = () => {
		logEl.innerHTML = log.map((e) => entryHtml(e, s.name)).join("");
		const pending = s.status === "busy" ? STREAMING[s.id] : null;
		if (pending) {
			const el = document.createElement("div");
			el.className = "entry agent streaming";
			el.innerHTML = `<div class="who">${esc(s.name)} <span class="tag">writing\u2026</span></div><div class="body"><p><span class="text"></span><span class="caret"></span></p></div>`;
			logEl.append(el);
			const text = el.querySelector(".text");
			let n = 0;
			streamTimer = setInterval(() => {
				n = n >= pending.length + 40 ? 0 : n + 1;
				text.textContent = pending.slice(0, n);
			}, 45);
		}
		logEl.scrollTop = logEl.scrollHeight;
	};
	const send = (text, tag, note) => {
		if (text) log.push({ role: "you", text, tag });
		if (note) log.push({ role: "note", text: note });
		clearInterval(streamTimer);
		render();
		renderActions();
	};
	const actEl = panel.querySelector(".act");
	const renderActions = () => {
		if (s.status === "waiting" && QUESTIONNAIRES[s.id]) {
			const qs = QUESTIONNAIRES[s.id];
			actEl.innerHTML = `<form class="form"><div class="form-title">${esc(s.name)} asks</div>${qs
				.map(
					(q, i) => `<fieldset><legend>${esc(q.question)}</legend>${q.options
						.map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${esc(o.label)}"${j === 0 ? " checked" : ""}><span><b>${esc(o.label)}</b><small>${esc(o.description)}</small></span></label>`)
						.join("")}<label class="opt other"><input type="radio" name="q${i}" value="__other"><span><b>Something else</b><input type="text" placeholder="Your answer"></span></label></fieldset>`,
				)
				.join("")}<div class="row"><button type="submit" class="primary">Answer</button></div></form>`;
			actEl.querySelector("form").onsubmit = (event) => {
				event.preventDefault();
				const answers = qs.map((q, i) => {
					const picked = actEl.querySelector(`input[name=q${i}]:checked`);
					return `${q.header}: ${picked.value === "__other" ? picked.parentElement.querySelector("input[type=text]").value || "(blank)" : picked.value}`;
				});
				s.status = "busy";
				hooks.changed(s);
				send(answers.join("\n"), "answer", "Sent as an answer command; the question also closes in the terminal (prototype: not wired).");
			};
			return;
		}
		const busy = s.status === "busy";
		actEl.innerHTML = `<textarea placeholder="${busy ? "Redirect it, or tell it something for after this turn" : "Reply"}"></textarea><div class="row">${
			busy
				? `<button data-send="steer" class="primary">Redirect now</button><button data-send="follow">Tell it after this</button><button data-send="stop" class="danger">Stop</button>`
				: `<button data-send="talk" class="primary">Reply</button>`
		}</div>`;
		const box = actEl.querySelector("textarea");
		actEl.querySelectorAll("button[data-send]").forEach((b) => {
			b.onclick = () => {
				const text = box.value.trim();
				const kind = b.dataset.send;
				if (kind === "stop") {
					s.status = "idle";
					hooks.changed(s);
					return send("", null, "You stopped the run (abort command; prototype: not wired).");
				}
				if (!text) return box.focus();
				if (kind === "talk") return send(text, null, "Sent as a new turn (talk command; prototype: not wired).");
				if (kind === "steer") return send(text, "redirect", "Delivered at the next safe point of the running turn (steer; prototype: not wired).");
				return send(text, "after this turn", "Queued until the turn ends (follow-up; prototype: not wired).");
			};
		});
		box.onkeydown = (event) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) actEl.querySelector("button.primary").click();
		};
	};
	render();
	renderActions();
	panel.onclick = (event) => {
		const act = event.target.closest("[data-act]")?.dataset.act;
		if (act === "close" || event.target === panel) closeTalk();
		if (act === "terminal") hooks.terminal(s);
	};
}

export function closeTalk() {
	clearInterval(streamTimer);
	panel.hidden = true;
}

export const talkOpen = () => !panel.hidden;

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && talkOpen()) closeTalk();
});
