import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)));
const entries = [
	...globSync(["{components,apps,extensions}/**/*.{runtime,worker,hot}.ts"], {
		cwd: root,
		exclude: ["**/dist/**", "**/node_modules/**"],
	}),
];
const failures = new Set();
const visited = new Set();
const forbiddenIO = new Set(["readFile", "readFileSync", "execSync", "execFileSync", "spawnSync"]);
const propertyModifiers = new Set([
	ts.SyntaxKind.PublicKeyword,
	ts.SyntaxKind.PrivateKeyword,
	ts.SyntaxKind.ProtectedKeyword,
	ts.SyntaxKind.ReadonlyKeyword,
	ts.SyntaxKind.OverrideKeyword,
]);

function isTypeOnlyDeclaration(node) {
	if (ts.isImportDeclaration(node)) {
		const clause = node.importClause;
		return (
			clause?.isTypeOnly ||
			(!clause?.name &&
				clause?.namedBindings &&
				ts.isNamedImports(clause.namedBindings) &&
				clause.namedBindings.elements.length > 0 &&
				clause.namedBindings.elements.every((part) => part.isTypeOnly))
		);
	}
	return (
		node.isTypeOnly ||
		(node.exportClause &&
			ts.isNamedExports(node.exportClause) &&
			node.exportClause.elements.length > 0 &&
			node.exportClause.elements.every((part) => part.isTypeOnly))
	);
}

function check(file, hot) {
	const key = `${hot}:${file}`;
	if (visited.has(key)) return;
	visited.add(key);
	const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
	const workerConstructors = new Set();
	for (const statement of source.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!["node:worker_threads", "worker_threads"].includes(statement.moduleSpecifier.text)
		)
			continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings && ts.isNamedImports(bindings)) {
			for (const binding of bindings.elements)
				if ((binding.propertyName ?? binding.name).text === "Worker") workerConstructors.add(binding.name.text);
		} else if (bindings && ts.isNamespaceImport(bindings)) workerConstructors.add(`${bindings.name.text}.Worker`);
	}
	const report = (node, message) => {
		const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
		failures.add(`${file}:${line + 1}:${character + 1}: ${message}`);
	};
	if (extname(file) === ".tsx") report(source, "Daemon and worker imports stay outside JSX/DOM modules.");
	const dependency = (specifier, node) => {
		if (/^(?:electron|react|react-dom|react-native)(?:\/|$)|\.(?:css|html|svg)$/.test(specifier))
			return report(node, "Daemon and worker code use Node modules and plain shared data, not UI imports.");
		if (!specifier.startsWith(".")) return;
		const target = resolve(dirname(file), specifier);
		const resolved = [target.replace(/\.js$/, ".ts"), target].find(existsSync);
		if (!resolved) return report(node, `Missing local execution dependency: ${specifier}`);
		if (/\.(?:[cm]?js|tsx?)$/.test(resolved)) check(resolved, hot);
	};
	function visit(node) {
		if (
			ts.isEnumDeclaration(node) ||
			ts.isModuleDeclaration(node) ||
			ts.isImportEqualsDeclaration(node) ||
			ts.isTypeAssertionExpression(node) ||
			(ts.isExportAssignment(node) && node.isExportEquals)
		)
			report(node, "Use erasable TypeScript in the daemon/worker import closure.");
		if (ts.isConstructorDeclaration(node))
			for (const parameter of node.parameters)
				if (parameter.modifiers?.some((modifier) => propertyModifiers.has(modifier.kind)))
					report(parameter, "Declare fields separately; Node type stripping cannot transform parameter properties.");
		if (
			hot &&
			((ts.isIdentifier(node) && forbiddenIO.has(node.text)) ||
				(ts.isElementAccessExpression(node) &&
					ts.isStringLiteral(node.argumentExpression) &&
					forbiddenIO.has(node.argumentExpression.text)))
		)
			report(node, "Hot paths use bounded file reads and asynchronous child processes.");
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			if (!isTypeOnlyDeclaration(node)) dependency(node.moduleSpecifier.text, node);
		}
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")
		) {
			const argument = node.arguments[0];
			if (argument && ts.isStringLiteral(argument)) dependency(argument.text, node);
			else report(node, "Use literal imports so the execution dependency contract can be checked.");
		}
		if (ts.isNewExpression(node) && node.expression.getText(source) === "URL") {
			const argument = node.arguments?.[0];
			if (argument && ts.isStringLiteral(argument) && /\.(?:runtime|worker)\.ts$/.test(argument.text))
				dependency(argument.text, node);
		}
		if (ts.isNewExpression(node) && workerConstructors.has(node.expression.getText(source))) {
			const url = node.arguments?.[0];
			const argument =
				url && ts.isNewExpression(url) && url.expression.getText(source) === "URL" ? url.arguments?.[0] : undefined;
			if (
				!argument ||
				!ts.isStringLiteral(argument) ||
				!argument.text.endsWith(".worker.ts") ||
				url.arguments?.[1]?.getText(source) !== "import.meta.url"
			)
				report(node, "Worker entries use an explicit module-relative .worker.ts URL.");
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}

if (!entries.some((file) => file.endsWith(".runtime.ts"))) failures.add("No .runtime.ts daemon entry found.");
for (const entry of entries) check(resolve(root, entry), entry.endsWith(".hot.ts"));
if (failures.size) {
	console.error([...failures].join("\n"));
	process.exitCode = 1;
} else
	console.log(
		`Path contracts passed: ${entries.length} entries, ${new Set([...visited].map((key) => key.slice(key.indexOf(":") + 1))).size} local modules.`,
	);
