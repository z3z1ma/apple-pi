import { QueryBuilder } from "@getgrit/gritql";

async function matches(job) {
	const query = new QueryBuilder(job.query);
	const found = new Map();
	query.filter((binding) => {
		const range = binding.range();
		if (range) found.set(`${range.start.line}:${range.start.column}`, { line: range.start.line, text: binding.text() });
		return true;
	});
	await query.applyToFile({ path: job.path, content: job.content });
	return { matches: [...found.values()] };
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const results = [];
for (const job of JSON.parse(input).jobs) {
	try {
		results.push(await matches(job));
	} catch (error) {
		results.push({ error: String(error?.message ?? error) });
	}
}
process.stdout.write(JSON.stringify(results), () => process.exit(0));
