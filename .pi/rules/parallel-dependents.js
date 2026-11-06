const writes = (call) => (call.tool === "edit" || call.tool === "write") && call.path;
const written = new Set(event.batch.filter(writes).map((call) => call.path));
const next = "Send the dependent call in the next message; a refused call does not stop the others.";
if (writes(event) && event.batch.some((call) => call.id !== event.id && writes(call) && call.path === event.path))
	return `this parallel batch edits ${event.path} more than once. ${next}`;
const used = event.tool === "read" ? [event.path] : event.tool === "bash" ? event.paths : [];
const path = used.find((each) => written.has(each));
if (path) return `this parallel batch edits ${path} and also ${event.tool === "read" ? "reads" : "uses"} it. ${next}`;
