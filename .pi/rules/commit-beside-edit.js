if (event.tool !== "bash" || !/\bgit\s+(add|commit)\b/.test(event.input.command)) return;
return event.batch.some((call) => call.tool === "edit" || call.tool === "write");
