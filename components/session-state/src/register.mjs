// Lets Node run this package's TypeScript source as-is: imports name `./x.js`, while the file is `./x.ts`.
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(`${specifier.slice(0, -3)}.ts`, context);
			throw error;
		}
	},
});
