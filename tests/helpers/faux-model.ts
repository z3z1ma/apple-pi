import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";

export function fauxModelBackend(model: Model<string>) {
	const modelRuntime = {
		getModel: () => model,
		getModels: () => [model],
		getProvider: () => undefined,
		getProviders: () => [],
		getAvailable: async () => [model],
		getAvailableSnapshot: () => [model],
		getError: () => undefined,
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ ok: true }),
		isUsingOAuth: () => false,
		isUsingSubscription: () => false,
		getAuth: async () => ({ auth: { apiKey: "faux", headers: {} } }),
		getProviderAuthStatus: () => "configured",
		getCompatibilityRequestConfig: () => ({}),
		getRegisteredProviderIds: () => [],
		getRegisteredProviderConfig: () => undefined,
		getRegisteredNativeProvider: () => undefined,
		registerProvider: () => {},
		registerNativeProvider: () => {},
		unregisterProvider: () => {},
		refresh: async () => ({}),
		stream: streamSimple,
		streamSimple,
	};
	const modelRegistry = {
		find: () => model,
		getAll: () => [model],
		getAvailable: () => [model],
		hasConfiguredAuth: () => true,
		isUsingOAuth: () => false,
		getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "faux", headers: {} }),
		registerProvider: () => {},
		unregisterProvider: () => {},
		runtime: modelRuntime,
	};
	return { modelRegistry, modelRuntime };
}
