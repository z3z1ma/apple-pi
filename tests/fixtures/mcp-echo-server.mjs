import readline from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.id === undefined) return;

	switch (request.method) {
		case "initialize":
			send({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					protocolVersion: "2025-03-26",
					capabilities: { tools: {} },
					serverInfo: { name: "apple-pi-test", version: "1.0.0" },
				},
			});
			break;
		case "tools/list":
			send({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					tools: [{
						name: "echo",
						description: "Echo a value",
						inputSchema: {
							type: "object",
							properties: { value: { type: "string" } },
							required: ["value"],
						},
					}],
				},
			});
			break;
		case "tools/call":
			send({
				jsonrpc: "2.0",
				id: request.id,
				result: {
					content: [{ type: "text", text: `echo:${request.params?.arguments?.value ?? ""}` }],
				},
			});
			break;
		default:
			send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
	}
});
