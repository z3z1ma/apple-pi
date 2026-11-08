const openaiTerminalCodes = new Set([
	"subscription_sharing_usage_limit_exceeded",
	"credit_balance_exhausted",
	"organization_spend_limit_exceeded",
	"project_spend_limit_exceeded",
	"organization_usage_limit_exceeded",
]);
const stopTypes = new Set(["authentication_error", "permission_error", "permission_denied", "invalid_request_error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blocksRecovery(type: unknown): boolean {
	return type !== undefined && (typeof type !== "string" || stopTypes.has(type));
}

function readErrorBody(provider: string, message: string): Record<string, unknown> | undefined {
	let text = message.trim();
	let status: number | undefined;
	if (provider === "openai") {
		text = text.replace(/\nCheck your ChatGPT usage: https:\/\/chatgpt\.com\/settings\/usage$/, "");
		const prefix = /^OpenAI API error \((\d{3})\):\s*/.exec(text);
		if (prefix) {
			status = Number(prefix[1]);
			text = text.slice(prefix[0].length);
		}
	}
	const http = /^(\d{3})(?::\s*|\s+)/.exec(text);
	if (http) {
		if (status !== undefined && status !== Number(http[1])) return;
		status = Number(http[1]);
		text = text.slice(http[0].length);
	}
	if (status !== undefined && status !== 429) return;
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return;
	}
	if (!isRecord(body) || blocksRecovery(body.type)) return;
	if (body.status !== undefined && body.status !== 429) return;
	const error = body.error === undefined ? body : body.error;
	if (!isRecord(error) || blocksRecovery(error.type) || (error.status !== undefined && error.status !== 429)) return;
	return error;
}

export function classifyTerminalProviderFailure(provider: string, message: string): string | undefined {
	if (provider === "antigravity") {
		return /^Quota reached\.(?: Please wait [^.\r\n]+\.)? Next: switch models or (?:try again after reset|retry later)\.$/.test(
			message,
		)
			? "quota-reached"
			: undefined;
	}
	if (provider !== "openai" && provider !== "anthropic") return;
	const error = readErrorBody(provider, message);
	if (!error) return;
	if (provider === "openai") {
		return typeof error.code === "string" && openaiTerminalCodes.has(error.code) ? error.code : undefined;
	}
	if (
		error.type === "rate_limit_error" &&
		isRecord(error.details) &&
		error.details.error_code === "enforced_spend_limit_reached"
	) {
		return "enforced_spend_limit_reached";
	}
	return;
}
