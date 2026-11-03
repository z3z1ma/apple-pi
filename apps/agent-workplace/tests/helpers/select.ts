import type { Locator } from "playwright-core";

export async function choose(select: Locator, value: string): Promise<void> {
	const label = (await select.getAttribute("aria-label")) ?? undefined;
	await select.click();
	await select
		.page()
		.getByRole("listbox", { name: label, exact: true })
		.locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
		.click();
}

export const chosen = (select: Locator) => select.getAttribute("data-value");

export async function addRecipient(scope: Locator, label: string, id: string): Promise<void> {
	await scope.getByRole("combobox", { name: `${label} recipients`, exact: true }).click();
	await scope
		.page()
		.getByRole("listbox", { name: `${label} suggestions`, exact: true })
		.locator(`[role="option"][data-value=${JSON.stringify(id)}]`)
		.click();
}

export const recipients = (scope: Locator) =>
	scope.locator(".wp-recipient-chip").evaluateAll((chips) => chips.map((chip) => chip.getAttribute("data-value")));
