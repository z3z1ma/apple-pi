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

export function say(name, line, options = ["Goodbye."]) {
	chat.innerHTML = `<div class="who">${esc(name)}</div><div class="line">${esc(line)}</div><div class="opts">${options
		.map((o, i) => `<div class="opt" data-i="${i}">${i + 1}. ${esc(o)}</div>`)
		.join("")}</div>`;
	chat.hidden = false;
	chat.onclick = (event) => {
		if (event.target.closest(".opt")) chat.hidden = true;
	};
}

export function closeChat() {
	chat.hidden = true;
}
