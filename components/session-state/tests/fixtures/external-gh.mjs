import { appendFileSync, readFileSync } from "node:fs";

const path = process.argv[process.argv.indexOf("GET") + 1];
appendFileSync(process.env.EXTERNAL_REQUESTS, `${path}\n`);
const routes = JSON.parse(readFileSync(process.env.EXTERNAL_FIXTURES, "utf8"));
let response = routes[path.split("?")[0]];
const since = new URL(`https://api.github.test/${path}`).searchParams.get("since");
if (since && path.split("?")[0].endsWith("/comments"))
	response = response.filter((item) => Date.parse(item.updated_at) > Date.parse(since));
if (routes.error) {
	process.stderr.write(routes.error);
	process.exit(1);
}
if (response === undefined) {
	process.stderr.write(`No fixture for ${path}`);
	process.exit(1);
}
process.stdout.write(JSON.stringify(process.argv.includes("--slurp") ? [response] : response));
