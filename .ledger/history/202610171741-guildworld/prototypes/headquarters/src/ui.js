// PROTOTYPE: RuneScape-style interaction chrome in HTML over the canvas: the hover action text (top left), the
// right-click menu, and the chatbox for talking to a character.
const hover = document.getElementById("hover");
const menu = document.getElementById("menu");
const chat = document.getElementById("chat");

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** An action: { verb, target?, kind?: "npc" | "object", run() }. */
export function showHover(actions) {
	if (!actions.length) {
		hover.innerHTML = "";
		return;
	}
	const [first] = actions;
	const more = actions.length - 1;
	hover.innerHTML = `${esc(first.verb)}${first.target ? ` <span class="${first.kind ?? "object"}">${esc(first.target)}</span>` : ""}${more ? ` <span class="more">/ ${more} more option${more > 1 ? "s" : ""}</span>` : ""}`;
}

export function openMenu(x, y, actions) {
	menu.innerHTML = `<div class="title">Choose Option</div>${actions
		.map((a, i) => `<div class="item" data-i="${i}">${esc(a.verb)}${a.target ? ` <span class="${a.kind ?? "object"}">${esc(a.target)}</span>` : ""}</div>`)
		.join("")}<div class="item" data-i="cancel">Cancel</div>`;
	menu.style.left = `${Math.max(4, Math.min(x - 60, innerWidth - 220))}px`;
	menu.style.top = `${Math.max(4, Math.min(y - 8, innerHeight - 40 - actions.length * 22))}px`;
	menu.hidden = false;
	menu.onclick = (event) => {
		const i = event.target.closest(".item")?.dataset.i;
		menu.hidden = true;
		if (i !== undefined && i !== "cancel") actions[Number(i)].run();
	};
	menu.onmouseleave = () => {
		menu.hidden = true;
	};
}

export const menuOpen = () => !menu.hidden;

let typing;

/** Show a line in the chatbox, typed out, with the speaker's portrait (JRPG-style) beside it when there is one. */
export function say(name, line, options = ["Goodbye."], portrait = null) {
	clearInterval(typing);
	chat.classList.toggle("with-portrait", Boolean(portrait));
	chat.innerHTML = `${portrait ? `<img class="portrait" src="${esc(portrait)}" alt="">` : ""}<div class="who">${esc(name)}</div><div class="line"></div><div class="opts" hidden>${options
		.map((o, i) => `<div class="opt" data-i="${i}">${i + 1}. ${esc(o)}</div>`)
		.join("")}</div>`;
	chat.hidden = false;
	const text = chat.querySelector(".line");
	const opts = chat.querySelector(".opts");
	const img = chat.querySelector(".portrait");
	let shown = 0;
	const finish = () => {
		clearInterval(typing);
		text.textContent = line;
		opts.hidden = false;
		img?.classList.remove("talking");
	};
	img?.classList.add("talking");
	typing = setInterval(() => {
		shown += 2;
		text.textContent = line.slice(0, shown);
		if (shown >= line.length) finish();
	}, 22);
	chat.onclick = (event) => {
		if (!opts.hidden && event.target.closest(".opt")) chat.hidden = true;
		else finish();
	};
}

export function closeChat() {
	chat.hidden = true;
}
