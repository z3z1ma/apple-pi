// @program: {"description": "Run one prompt through the real installed Pi in RPC mode, in a temporary directory, and report its final reply, custom messages and usage.", "parameters": {"prompt": {"type": "string", "description": "Prompt to send to the root session"}, "wait_for": {"type": "string", "default": "", "description": "Custom message type to wait for after the run; empty waits for the run to end"}, "timeout": {"type": "integer", "default": 240, "description": "Seconds before the run is stopped"}}, "required": ["prompt"]}
return await tools.bash({
	verbatim: true,
	timeout: inputs.timeout + 30,
	command: "node .pi/programs/rpc-smoke-driver.mjs",
	stdin: JSON.stringify({ prompt: inputs.prompt, waitFor: inputs.wait_for, timeoutMs: inputs.timeout * 1000 }),
});
