import { createReplyWatches } from "./reply-watches.js";

const embeddedWorld = location.search === "?world&embedded=1";
if (embeddedWorld) {
	const host = window.parent;
	if (
		host === window ||
		host.location.origin !== location.origin ||
		host.location.pathname !== location.pathname ||
		window.frameElement?.getAttribute("title") !== "Agent World" ||
		!host.agentWorld ||
		!host.agentWorldReplyWatches
	)
		throw new Error("Embedded World requires the Workplace host.");
	window.agentWorld = host.agentWorld;
	window.agentWorldReplyWatches = host.agentWorldReplyWatches;
} else {
	window.agentWorldReplyWatches = createReplyWatches(window.agentWorld);
}

// The standalone World route remains available for game fixtures and captures.
if (location.search !== "?world" && !embeddedWorld) {
	await import("./workplace.js");
} else {
	await import("./main.js");
	if (!embeddedWorld) {
		const link = document.createElement("a");
		link.href = "?workplace=chat";
		link.textContent = "Workplace";
		link.style.cssText =
			"position:fixed;left:16px;top:12px;z-index:9;padding:8px 14px;border-radius:8px;background:#fff;color:#282238;font:13px system-ui;text-decoration:none";
		document.body.append(link);
	}
}
