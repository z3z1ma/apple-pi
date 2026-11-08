if (event.tool !== "codemode") return;
const code = typeof event.input === "string" ? event.input : event.input?.code;
if (typeof code !== "string") return;
const reason = "link returns plain text. Output its result directly; use JSON.parse only for a tool with an explicit JSON output contract.";
if (/JSON\s*\.\s*parse\s*\(\s*await\s+tools\s*\.\s*link\s*\(/.test(code)) return reason;
for (const match of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+tools\s*\.\s*link\s*\(/g)) {
	const name = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (new RegExp(`JSON\\s*\\.\\s*parse\\s*\\(\\s*${name}\\s*\\)`).test(code.slice(match.index))) return reason;
}
