export interface Valuation {
	value: number | null;
	costOfDelayPerHour: number;
	estimatedBy: string | null;
}

export interface Worth {
	value?: number;
	cost_of_delay?: number;
}

const AMOUNT = String.raw`\$([\d.eE+-]+)`;
const VALUE = new RegExp(String.raw`^Value:\s*${AMOUNT}(?:\s*\(estimated by (.+)\))?\s*$`, "m");
const DELAY = new RegExp(String.raw`^Cost of delay:\s*${AMOUNT}\s*/\s*(hour|day)\s*$`, "m");

export function readValuation(markdown: string): Valuation {
	const header = markdown.split(/^#\s/m)[0];
	const value = header.match(VALUE);
	const delay = header.match(DELAY);
	const cost = amount(delay?.[1]);
	return {
		value: amount(value?.[1]),
		costOfDelayPerHour: cost === null ? 0 : cost / (delay?.[2] === "day" ? 24 : 1),
		estimatedBy: value?.[2]?.trim() ?? null,
	};
}

function amount(text: string | undefined): number | null {
	const number = text === undefined ? Number.NaN : Number(text);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

export function worthLines(worth: Worth, writer: string): string {
	return (
		(worth.value === undefined ? "" : `Value: $${worth.value} (estimated by ${writer})\n`) +
		(worth.cost_of_delay === undefined ? "" : `Cost of delay: $${worth.cost_of_delay}/hour\n`)
	);
}
