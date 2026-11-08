import { describe, expect, it } from "vitest";
import { classifyTerminalProviderFailure } from "../src/classify.js";

const openaiCodes = [
	"subscription_sharing_usage_limit_exceeded",
	"credit_balance_exhausted",
	"organization_spend_limit_exceeded",
	"project_spend_limit_exceeded",
	"organization_usage_limit_exceeded",
];

describe("terminal provider failure classification", () => {
	it.each(openaiCodes)("recognizes OpenAI error.code %s in normalized bodies", (code) => {
		for (const body of [{ error: { code, type: "insufficient_quota" } }, { code }]) {
			for (const prefix of ["", "429 ", "429: ", "OpenAI API error (429): ", "OpenAI API error (429): 429 "]) {
				expect(classifyTerminalProviderFailure("openai", prefix + JSON.stringify(body))).toBe(code);
			}
		}
	});

	it("recognizes the installed OpenAI adapter's appended subscription usage hint", () => {
		const code = "subscription_sharing_usage_limit_exceeded";
		const body = JSON.stringify({ error: { code } });
		const message = `OpenAI API error (429): ${body}\nCheck your ChatGPT usage: https://chatgpt.com/settings/usage`;
		expect(classifyTerminalProviderFailure("openai", message)).toBe(code);
	});

	it.each([
		"insufficient_quota",
		"rate_limit_exceeded",
		"slow_down",
		"subscription_sharing_workplace_individual_usage_limit_exceeded",
		"invalid_api_key",
		"model_not_found",
		"constructor",
		"unknown",
	])("keeps OpenAI %s outside automatic recovery", (code) => {
		expect(classifyTerminalProviderFailure("openai", JSON.stringify({ error: { code } }))).toBeUndefined();
	});

	it.each([400, 401, 403, 404, 500])("rejects quota codes under conflicting HTTP status %s", (status) => {
		const body = JSON.stringify({ error: { code: "credit_balance_exhausted" } });
		expect(classifyTerminalProviderFailure("openai", `OpenAI API error (${status}): ${body}`)).toBeUndefined();
		expect(classifyTerminalProviderFailure("openai", `${status} ${body}`)).toBeUndefined();
		expect(
			classifyTerminalProviderFailure(
				"openai",
				JSON.stringify({ status, error: { code: "credit_balance_exhausted" } }),
			),
		).toBeUndefined();
		expect(
			classifyTerminalProviderFailure(
				"openai",
				JSON.stringify({ error: { status, code: "credit_balance_exhausted" } }),
			),
		).toBeUndefined();
	});

	it.each(["authentication_error", "permission_error", "invalid_request_error"])(
		"rejects quota codes under explicit %s",
		(type) => {
			expect(
				classifyTerminalProviderFailure(
					"openai",
					JSON.stringify({ error: { type, code: "credit_balance_exhausted" } }),
				),
			).toBeUndefined();
		},
	);

	it("recognizes Anthropic's documented Messages API spend detail", () => {
		const body = {
			type: "error",
			error: { type: "rate_limit_error", details: { error_code: "enforced_spend_limit_reached" } },
		};
		expect(classifyTerminalProviderFailure("anthropic", `429 ${JSON.stringify(body)}`)).toBe(
			"enforced_spend_limit_reached",
		);
		expect(classifyTerminalProviderFailure("openai", JSON.stringify(body))).toBeUndefined();
		expect(classifyTerminalProviderFailure("anthropic", '{"error":{"type":"rate_limit_error"}}')).toBeUndefined();
		expect(classifyTerminalProviderFailure("anthropic", "You've hit your usage limit")).toBeUndefined();
	});

	it.each([
		"Quota reached. Please wait for reset. Next: switch models or try again after reset.",
		"Quota reached. Please wait 2h 5m. Next: switch models or retry later.",
		"Quota reached. Next: switch models or retry later.",
	])("recognizes the inspected Antigravity terminal template: %s", (message) => {
		expect(classifyTerminalProviderFailure("antigravity", message)).toBe("quota-reached");
		expect(classifyTerminalProviderFailure("openai", message)).toBeUndefined();
	});

	it.each(["xai", "openrouter", "github-copilot", "unknown"])(
		"does not infer %s quota semantics from OpenAI-shaped bodies",
		(provider) => {
			expect(
				classifyTerminalProviderFailure(provider, '{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}'),
			).toBeUndefined();
		},
	);

	it.each([
		"RESOURCE_EXHAUSTED",
		"Quota reached.",
		"Quota reached. Next: ask an administrator.",
		"429 too many requests",
		"Quota exceeded",
		"Quota reached. Please wait for reset. Ask your administrator. Next: switch models or retry later.",
		'Failure containing {"error":{"code":"credit_balance_exhausted"}}',
		'{"error":{"code":"credit_balance_exhausted"}',
		'{"error":"invalid_api_key","code":"credit_balance_exhausted"}',
	])("leaves unsupported or ambiguous messages alone: %s", (message) => {
		for (const provider of ["openai", "anthropic", "antigravity", "xai"]) {
			expect(classifyTerminalProviderFailure(provider, message)).toBeUndefined();
		}
	});
});
