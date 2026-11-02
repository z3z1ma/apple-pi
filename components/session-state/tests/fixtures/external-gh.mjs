import { appendFileSync, readFileSync } from "node:fs";

const path = process.argv[process.argv.indexOf("GET") + 1];
appendFileSync(process.env.EXTERNAL_REQUESTS, `${path}\n`);
const routes = JSON.parse(readFileSync(process.env.EXTERNAL_FIXTURES, "utf8"));
const response = routes[path.split("?")[0]];
if (routes.error) {
	process.stderr.write(routes.error);
	process.exit(1);
}
if (response === undefined) {
	process.stderr.write(`No fixture for ${path}`);
	process.exit(1);
}
process.stdout.write(JSON.stringify(process.argv.includes("--slurp") ? [response] : response));
