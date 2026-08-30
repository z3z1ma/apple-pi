/** Reject values JSON would silently coerce, omit, or structurally change. */
export function serializeJsonValue(value: unknown, subject: string): string {
	const seen = new Set<object>();
	const validate = (nested: unknown): void => {
		if (nested === null || typeof nested === "string" || typeof nested === "boolean") return;
		if (typeof nested === "number") {
			if (!Number.isFinite(nested) || Object.is(nested, -0)) {
				throw new TypeError(`${subject} contains a number that JSON cannot preserve`);
			}
			return;
		}
		if (typeof nested !== "object") throw new TypeError(`${subject} contains a value that JSON cannot preserve`);
		if (seen.has(nested)) throw new TypeError(`${subject} contains a repeated or cyclic object reference`);
		seen.add(nested);
		if (Array.isArray(nested)) {
			const keys = Reflect.ownKeys(nested);
			if (keys.length !== nested.length + 1 || keys.some((key) => typeof key !== "string")) {
				throw new TypeError(`${subject} contains a sparse array or symbol key`);
			}
			for (let index = 0; index < nested.length; index++) {
				const descriptor = Object.getOwnPropertyDescriptor(nested, String(index));
				if (!descriptor?.enumerable || !("value" in descriptor)) {
					throw new TypeError(`${subject} contains a sparse array or accessor`);
				}
				validate(descriptor.value);
			}
			return;
		}
		if (Object.getPrototypeOf(nested) !== Object.prototype && Object.getPrototypeOf(nested) !== null) {
			throw new TypeError(`${subject} contains a non-plain object`);
		}
		for (const key of Reflect.ownKeys(nested)) {
			if (typeof key !== "string") throw new TypeError(`${subject} contains a symbol key`);
			const descriptor = Object.getOwnPropertyDescriptor(nested, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new TypeError(`${subject} contains an accessor or non-enumerable property`);
			}
			validate(descriptor.value);
		}
	};
	validate(value);
	return JSON.stringify(value);
}
