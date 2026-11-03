import type { Locator } from "playwright-core";

/**
 * Choose `value` in a Workplace select (`workplace-fields.tsx`): open its list and click the option carrying that
 * value, as the operator does. Its chosen value reads back from the control's `data-value`.
 */
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

/** Add the person `id` to a Workplace recipients field labelled `label` (such as "To") inside `scope`. */
export async function addRecipient(scope: Locator, label: string, id: string): Promise<void> {
	await scope.getByRole("combobox", { name: `${label} recipients`, exact: true }).click();
	await scope
		.page()
		.getByRole("listbox", { name: `${label} suggestions`, exact: true })
		.locator(`[role="option"][data-value=${JSON.stringify(id)}]`)
		.click();
}

/** The ids chosen in the recipients fields inside `scope`, in order. */
export const recipients = (scope: Locator) =>
	scope.locator(".wp-recipient-chip").evaluateAll((chips) => chips.map((chip) => chip.getAttribute("data-value")));
