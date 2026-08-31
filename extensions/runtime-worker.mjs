import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";
import { STDLIB_SETUP_SOURCE } from "./runtime-stdlib.mjs";
import { installWebHostHelpers, WEB_SETUP_SOURCE } from "./runtime-web.mjs";

if (!parentPort) throw new Error("pi_exec worker requires a parent port");

let nextCallId = 1;
const pending = new Map();
const callIds = new WeakMap();

const callOutcome = (ok, value) => {
	try {
		return JSON.stringify(ok ? { ok: true, value } : { ok: false, error: String(value) });
	} catch (error) {
		return JSON.stringify({
			ok: false,
			error: `pi_exec host result is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
};

const hostCall = (ref, args = {}) => {
	const id = nextCallId++;
	const promise = new Promise((resolve) => {
		pending.set(id, { resolve });
		try {
			parentPort.postMessage({ type: "call", id, ref, args });
		} catch (error) {
			pending.delete(id);
			resolve(
				callOutcome(
					false,
					`pi_exec call arguments are not serializable: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	});
	callIds.set(promise, id);
	return promise;
};

const cancelHostCall = (promise, reason = "host call aborted") => {
	const id = callIds.get(promise);
	const request = id === undefined ? undefined : pending.get(id);
	if (id === undefined || !request) return;
	pending.delete(id);
	request.resolve(callOutcome(false, reason));
	parentPort.postMessage({ type: "cancel", id, reason: String(reason) });
};

const MAX_LOG_CHARS = 20_000;
let logChars = 0;
let logsTruncated = false;
const logValue = (value) => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};
const guestPrint = (...values) => {
	if (logsTruncated) return;
	const line = values.map(logValue).join(" ");
	const remaining = MAX_LOG_CHARS - logChars;
	if (line.length > remaining) {
		if (remaining > 0) parentPort.postMessage({ type: "log", values: [line.slice(0, remaining)] });
		parentPort.postMessage({ type: "log", values: ["[pi_exec logs truncated]"] });
		logsTruncated = true;
		return;
	}
	logChars += line.length;
	parentPort.postMessage({ type: "log", values: [line] });
};

parentPort.on("message", (message) => {
	if (message?.type !== "call_result") return;
	const request = pending.get(message.id);
	if (!request) return;
	pending.delete(message.id);
	request.resolve(
		typeof message.outcome === "string"
			? message.outcome
			: callOutcome(message.ok, message.ok ? message.value : message.error || "host call failed"),
	);
});

process.on("unhandledRejection", (error) => {
	parentPort.postMessage({
		type: "failed",
		error: `Unawaited pi_exec promise rejected: ${error instanceof Error ? error.stack || error.message : String(error)}`,
	});
});

const sandbox = Object.create(null);
const guestTimers = new Map();
let nextTimerId = 1;
const guestSetTimeout = (callback, milliseconds = 0, ...args) => {
	if (typeof callback !== "function") throw new TypeError("setTimeout callback must be a function");
	const id = nextTimerId++;
	const delay = Math.max(0, Math.min(Number(milliseconds) || 0, 30 * 60 * 1_000));
	const timer = setTimeout(() => {
		guestTimers.delete(id);
		callback(...args);
	}, delay);
	timer.unref?.();
	guestTimers.set(id, timer);
	return id;
};
const guestSetInterval = (callback, milliseconds = 0, ...args) => {
	if (typeof callback !== "function") throw new TypeError("setInterval callback must be a function");
	const id = nextTimerId++;
	const delay = Math.max(0, Math.min(Number(milliseconds) || 0, 30 * 60 * 1_000));
	const timer = setInterval(callback, delay, ...args);
	timer.unref?.();
	guestTimers.set(id, timer);
	return id;
};
const guestClearTimer = (id) => {
	const timer = guestTimers.get(id);
	if (timer) {
		clearTimeout(timer);
		clearInterval(timer);
	}
	guestTimers.delete(id);
};

sandbox.__hostCall = hostCall;
sandbox.__cancelHostCall = cancelHostCall;
sandbox.__print = guestPrint;
sandbox.__setTimeout = guestSetTimeout;
sandbox.__setInterval = guestSetInterval;
sandbox.__clearTimer = guestClearTimer;
sandbox.__inputs = workerData.inputs ?? {};
sandbox.__state = workerData.state ?? {};
installWebHostHelpers(sandbox);
const context = vm.createContext(sandbox, {
	name: "apple-pi-exec",
	codeGeneration: { strings: false, wasm: false },
});

const setup = new vm.Script(
	`
(() => {
  "use strict";
  const callHost = globalThis.__hostCall;
  const cancelHostCall = globalThis.__cancelHostCall;
  const emitLog = globalThis.__print;
  const scheduleTimeout = globalThis.__setTimeout;
  const scheduleInterval = globalThis.__setInterval;
  const cancelTimeout = globalThis.__clearTimer;
  const webSync = globalThis.__webSync;
  const providedInputs = JSON.parse(JSON.stringify(globalThis.__inputs));
  const providedState = JSON.parse(JSON.stringify(globalThis.__state));
  delete globalThis.__hostCall;
  delete globalThis.__cancelHostCall;
  delete globalThis.__print;
  delete globalThis.__setTimeout;
  delete globalThis.__setInterval;
  delete globalThis.__clearTimer;
  delete globalThis.__webSync;
  delete globalThis.__inputs;
  delete globalThis.__state;

  const NativePromise = Promise;
  const nativePromiseThen = Promise.prototype.then;
  const nativeWeakMapGet = WeakMap.prototype.get;
  const nativeWeakMapSet = WeakMap.prototype.set;
  const applyFunction = Reflect.apply;
  const callHandles = new WeakMap();
  const call = (ref, args = {}) => {
    const hostPromise = callHost(ref, args);
    const adopted = new NativePromise((resolve) => hostPromise.then(resolve));
    const promise = applyFunction(nativePromiseThen, adopted, [(serialized) => {
      const outcome = JSON.parse(serialized);
      if (outcome.ok) return outcome.undefined === true ? undefined : outcome.value;
      throw new Error(outcome.error || "host call failed");
    }]);
    applyFunction(nativeWeakMapSet, callHandles, [promise, hostPromise]);
    return promise;
  };
  const cancelCall = (promise, reason) => cancelHostCall(
    applyFunction(nativeWeakMapGet, callHandles, [promise]),
    reason,
  );

  const coreNames = ["read", "grep", "find", "ls", "bash", "edit", "write"];
  const piApi = Object.create(null);
  for (const name of coreNames) {
    Object.defineProperty(piApi, name, {
      enumerable: true,
      value: (args = {}) => call("pi." + name, args),
    });
  }
  globalThis.pi = Object.freeze(piApi);
  globalThis.inputs = Object.freeze(providedInputs);
  Object.defineProperty(globalThis, "state", {
    enumerable: true,
    configurable: false,
    writable: false,
    value: providedState,
  });
  const displayError = () => {
    throw new Error("display is a pi_exec tool parameter, not a program global. Pass display: { name, description } on the pi_exec call.");
  };
  globalThis.display = new Proxy(Object.create(null), {
    get: displayError,
    set: displayError,
  });
  const genericCall = (nameOrRequest, args = {}) => {
    const request = typeof nameOrRequest === "string"
      ? { name: nameOrRequest, args }
      : nameOrRequest;
    return call("tools.call", request);
  };
  globalThis.tools = Object.freeze({
    list: () => call("tools.list", {}),
    search: (query) => call("tools.search", { query }),
    describe: (name) => call("tools.describe", { name }),
    call: genericCall,
  });
  globalThis.extensions = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      return (args = {}) => genericCall(String(property), args);
    },
  });
  const hasContextMark = (value) => {
    if (value && typeof value === "object" && CONTEXT_MARKS.get(value)) return true;
    if (Array.isArray(value)) return value.some(hasContextMark);
    return Boolean(value && typeof value === "object" && Object.values(value).some(hasContextMark));
  };
  const runAgent = async (request) => {
    const prepared = typeof request === "string" ? { task: request } : request;
    if (!prepared || typeof prepared !== "object" || !hasContextMark(prepared.context)) return call("agent.run", prepared);
    const fitted = contextFit(prepared.context);
    const { context: _context, ...agentRequest } = prepared;
    const result = await call("agent.run", fitted.value === undefined ? agentRequest : { ...agentRequest, context: fitted.value });
    return { ...result, context: { truncated: fitted.truncated, dropped: fitted.dropped, serializedChars: fitted.serializedChars } };
  };
  const agent = async (request) => {
    const result = await runAgent(request);
    if (!result || result.status !== "completed") {
      throw new Error(result && result.error ? result.error : "Agent did not complete");
    }
    return result.value !== undefined ? result.value : result.text;
  };
  Object.defineProperty(agent, "run", {
    enumerable: true,
    configurable: false,
    writable: false,
    value: runAgent,
  });
  globalThis.agent = Object.freeze(agent);
  globalThis.skills = Object.freeze({
    list: () => call("skills.list", {}),
    body: (request = {}) => call("skills.body", request),
  });
  globalThis.print = (...values) => emitLog(...values);
  globalThis.console = Object.freeze({ log: print, info: print, warn: print, error: print });
  globalThis.setTimeout = (callback, milliseconds = 0, ...args) => scheduleTimeout(callback, milliseconds, ...args);
  globalThis.clearTimeout = (id) => cancelTimeout(id);
  globalThis.setInterval = (callback, milliseconds = 0, ...args) => scheduleInterval(callback, milliseconds, ...args);
  globalThis.clearInterval = (id) => cancelTimeout(id);
  globalThis.sleep = (milliseconds) => new Promise((resolve) => scheduleTimeout(resolve, milliseconds));

${WEB_SETUP_SOURCE}

  const runWithConcurrency = async (jobs, concurrency) => {
    if (!Array.isArray(jobs) || jobs.some((job) => typeof job !== "function")) {
      throw new TypeError("parallel expects functions or an items array plus mapper");
    }
    if (jobs.length === 0) return [];
    const width = Math.max(1, Math.min(jobs.length, Math.floor(Number(concurrency) || jobs.length)));
    const values = new Array(jobs.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: width }, async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        values[index] = await jobs[index]();
      }
    }));
    return values;
  };

  globalThis.parallel = (items, mapperOrConcurrency, maybeConcurrency) => {
    if (!Array.isArray(items)) throw new TypeError("parallel expects an array");
    if (typeof mapperOrConcurrency === "function") {
      return runWithConcurrency(
        items.map((item, index) => () => mapperOrConcurrency(item, index)),
        maybeConcurrency,
      );
    }
    return runWithConcurrency(items, mapperOrConcurrency);
  };

  globalThis.pipeline = async (items, ...stages) => {
    if (!Array.isArray(items) || stages.some((stage) => typeof stage !== "function")) {
      throw new TypeError("pipeline expects an items array followed by stage functions");
    }
    return parallel(items, async (item, index) => {
      let value = item;
      for (const stage of stages) value = await stage(value, item, index);
      return value;
    });
  };

${STDLIB_SETUP_SOURCE}
})();
`,
	{ filename: "apple-pi-setup.js" },
);

const errorText = (error) => (error instanceof Error ? error.stack || error.message : String(error));
const initialState = JSON.stringify(workerData.state ?? {});
const serializeJsonValue = new vm.Script(
	`(value, subject) => {
  const seen = new Set();
  const validate = (value) => {
    const type = typeof value;
    if (value === null || type === "string" || type === "boolean") return;
    if (type === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError(subject + " contains a number that JSON cannot preserve");
      }
      return;
    }
    if (type !== "object") throw new TypeError(subject + " contains a value that JSON cannot preserve");
    if (seen.has(value)) throw new TypeError(subject + " contains a repeated or cyclic object reference");
    seen.add(value);
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
        throw new TypeError(subject + " contains a sparse array or symbol key");
      }
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(subject + " contains a sparse array or accessor");
        }
        validate(descriptor.value);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(subject + " contains a non-plain object");
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") throw new TypeError(subject + " contains a symbol key");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(subject + " contains an accessor or non-enumerable property");
        }
        validate(descriptor.value);
      }
    }
  };
  validate(value);
  return JSON.stringify(value);
}`,
	{ filename: "pi-exec-state.js" },
);

try {
	setup.runInContext(context, { timeout: workerData.timeoutMs });
	const program = new vm.Script(`(async () => {\n"use strict";\n${workerData.code}\n})()`, {
		filename: "pi-exec-program.js",
	});
	const promise = program.runInContext(context, { timeout: workerData.timeoutMs });
	Promise.resolve(promise).then(
		(value) => {
			const unfinishedCalls = pending.size;
			setImmediate(() => {
				if (unfinishedCalls > 0) {
					parentPort.postMessage({
						type: "failed",
						error: `pi_exec program returned before ${unfinishedCalls} host call(s) were awaited`,
					});
					return;
				}
				let stateJson;
				try {
					stateJson = serializeJsonValue.runInContext(context)(context.state, "state");
				} catch (error) {
					parentPort.postMessage({
						type: "failed",
						error: `pi_exec state is not JSON-serializable: ${errorText(error)}`,
					});
					return;
				}
				try {
					const valueJson = serializeJsonValue.runInContext(context)(value, "result");
					parentPort.postMessage({
						type: "done",
						value: JSON.parse(valueJson),
						...(stateJson !== initialState ? { state: JSON.parse(stateJson), stateChanged: true } : {}),
					});
				} catch (error) {
					parentPort.postMessage({
						type: "failed",
						error: `pi_exec result is not serializable: ${errorText(error)}`,
					});
				}
			});
		},
		(error) => parentPort.postMessage({ type: "failed", error: errorText(error) }),
	);
} catch (error) {
	parentPort.postMessage({ type: "failed", error: errorText(error) });
}
