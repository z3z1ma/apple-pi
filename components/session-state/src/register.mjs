import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const host = process.env.PI_HOST_PACKAGE_DIR;
const hostParent = host ? pathToFileURL(join(host, "package.json")).href : undefined;
const bare = (specifier) => !/^(\.|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(`${specifier.slice(0, -3)}.ts`, context);
			if (hostParent && bare(specifier) && error?.code === "ERR_MODULE_NOT_FOUND")
				return next(specifier, { ...context, parentURL: hostParent });
			throw error;
		}
	},
});
