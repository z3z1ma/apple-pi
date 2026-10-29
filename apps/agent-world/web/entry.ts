// World stays the default. Workplace loads only when the query asks for it.
if (new URLSearchParams(location.search).has("workplace")) {
	await import("./workplace.js");
} else {
	await import("./main.js");
	const link = document.createElement("a");
	link.href = "?workplace=chat";
	link.textContent = "Workplace";
	link.style.cssText =
		"position:fixed;left:16px;top:12px;z-index:9;padding:8px 14px;border-radius:8px;background:#fff;color:#282238;font:13px system-ui;text-decoration:none";
	document.body.append(link);
}

export {};
