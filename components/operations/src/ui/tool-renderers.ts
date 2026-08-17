export function throttleUpdates<T>(send: (value: T) => void, ms = 200): (value: T) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: T | undefined;
	return (value: T) => {
		pending = value;
		if (timer) return;
		send(value);
		timer = setTimeout(() => {
			timer = undefined;
			if (pending !== value && pending !== undefined) send(pending);
		}, ms);
	};
}
