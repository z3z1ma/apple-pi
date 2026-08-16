const ok = (value) => JSON.stringify({ ok: true, value });
const failed = (error) => JSON.stringify({
  ok: false,
  error: {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  },
});

const urlValue = (url) => ({
  href: url.href,
  origin: url.origin,
  protocol: url.protocol,
  username: url.username,
  password: url.password,
  host: url.host,
  hostname: url.hostname,
  port: url.port,
  pathname: url.pathname,
  search: url.search,
  hash: url.hash,
});

/**
 * Install synchronous host helpers which return only strings or numbers. Guest
 * wrappers copy those primitive results into their own VM realm, so native Node
 * constructors never become an escape hatch from the context.
 */
export function installWebHostHelpers(sandbox) {
  const decoders = new Map();
  let nextDecoderId = 1;

  sandbox.__webSync = (requestText) => {
    try {
      const request = JSON.parse(String(requestText));
      const args = request.args ?? {};
      switch (request.type) {
        case "atob":
          return ok(globalThis.atob(String(args.value)));
        case "btoa":
          return ok(globalThis.btoa(String(args.value)));
        case "textEncode": {
          const bytes = new TextEncoder().encode(String(args.value));
          return ok(Buffer.from(bytes).toString("base64"));
        }
        case "textEncodeInto": {
          const destination = new Uint8Array(Math.max(0, Number(args.length) || 0));
          const result = new TextEncoder().encodeInto(String(args.value), destination);
          return ok({
            read: result.read,
            written: result.written,
            bytes: Buffer.from(destination.subarray(0, result.written)).toString("base64"),
          });
        }
        case "textDecoderCreate": {
          const decoder = new TextDecoder(args.label, args.options);
          const id = nextDecoderId++;
          decoders.set(id, decoder);
          return ok({
            id,
            encoding: decoder.encoding,
            fatal: decoder.fatal,
            ignoreBOM: decoder.ignoreBOM,
          });
        }
        case "textDecode": {
          const decoder = decoders.get(Number(args.id));
          if (!decoder) throw new TypeError("Unknown TextDecoder instance");
          const bytes = Buffer.from(String(args.bytes ?? ""), "base64");
          const decoded = decoder.decode(bytes, args.options);
          return ok({ bytes: Buffer.from(new TextEncoder().encode(decoded)).toString("base64") });
        }
        case "url": {
          const url = args.base === undefined
            ? new URL(String(args.input))
            : new URL(String(args.input), String(args.base));
          if (Array.isArray(args.set)) {
            const [property, value] = args.set;
            if (!new Set([
              "href", "protocol", "username", "password", "host", "hostname",
              "port", "pathname", "search", "hash",
            ]).has(property)) throw new TypeError(`Cannot set URL property ${String(property)}`);
            url[property] = String(value);
          }
          return ok(urlValue(url));
        }
        case "urlCanParse":
          return ok(URL.canParse(String(args.input), args.base === undefined ? undefined : String(args.base)));
        case "searchParams": {
          const params = args.initPairs
            ? new URLSearchParams(args.initPairs)
            : new URLSearchParams(String(args.query ?? ""));
          const values = Array.isArray(args.values) ? args.values.map(String) : [];
          let result;
          switch (args.operation) {
            case "append": params.append(values[0], values[1]); break;
            case "delete": values.length > 1 ? params.delete(values[0], values[1]) : params.delete(values[0]); break;
            case "get": result = params.get(values[0]); break;
            case "getAll": result = params.getAll(values[0]); break;
            case "has": result = values.length > 1 ? params.has(values[0], values[1]) : params.has(values[0]); break;
            case "set": params.set(values[0], values[1]); break;
            case "sort": params.sort(); break;
            case "snapshot": break;
            default: throw new TypeError(`Unknown URLSearchParams operation ${String(args.operation)}`);
          }
          return ok({ query: params.toString(), pairs: [...params], result });
        }
        case "headers": {
          const headers = new Headers(args.pairs ?? []);
          const values = Array.isArray(args.values) ? args.values.map(String) : [];
          let result;
          switch (args.operation) {
            case "append": headers.append(values[0], values[1]); break;
            case "delete": headers.delete(values[0]); break;
            case "get": result = headers.get(values[0]); break;
            case "getSetCookie": result = headers.getSetCookie(); break;
            case "has": result = headers.has(values[0]); break;
            case "set": headers.set(values[0], values[1]); break;
            case "snapshot": break;
            default: throw new TypeError(`Unknown Headers operation ${String(args.operation)}`);
          }
          return ok({ pairs: [...headers], result });
        }
        default:
          throw new TypeError(`Unknown web helper ${String(request.type)}`);
      }
    } catch (error) {
      return failed(error);
    }
  };
}

/** Source evaluated inside the VM context. It expects call, cancelCall, webSync,
 * scheduleTimeout, and cancelTimeout lexical bindings from runtime-worker.mjs. */
export const WEB_SETUP_SOURCE = String.raw`
  const webOperation = (type, args = {}) => {
    const outcome = JSON.parse(webSync(JSON.stringify({ type, args })));
    if (outcome.ok) return outcome.value;
    const error = new Error(outcome.error && outcome.error.message ? outcome.error.message : "Web operation failed");
    error.name = outcome.error && outcome.error.name ? outcome.error.name : "Error";
    throw error;
  };

  const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const BASE64_VALUES = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index++) {
    BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  const bytesToBase64 = (bytes) => {
    let output = "";
    let chunk = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index];
      const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
      const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
      chunk += BASE64_ALPHABET[first >> 2]
        + BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)]
        + (index + 1 < bytes.length ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)] : "=")
        + (index + 2 < bytes.length ? BASE64_ALPHABET[third & 63] : "=");
      if (chunk.length >= 16_384) { output += chunk; chunk = ""; }
    }
    return output + chunk;
  };
  const base64ToBytes = (value) => {
    const encoded = String(value).replace(/[\t\n\f\r ]/g, "");
    let padding = 0;
    while (padding < encoded.length && encoded[encoded.length - 1 - padding] === "=") padding++;
    const contentLength = encoded.length - padding;
    let valid = encoded.length % 4 === 0 && padding <= 2;
    for (let index = 0; valid && index < contentLength; index++) {
      const code = encoded.charCodeAt(index);
      valid = code < BASE64_VALUES.length && BASE64_VALUES[code] >= 0;
    }
    for (let index = contentLength; valid && index < encoded.length; index++) valid = encoded[index] === "=";
    if (!valid) throw new TypeError("Invalid base64 data");
    const bytes = new Uint8Array(encoded.length / 4 * 3 - padding);
    let offset = 0;
    for (let index = 0; index < encoded.length; index += 4) {
      const first = BASE64_VALUES[encoded.charCodeAt(index)];
      const second = BASE64_VALUES[encoded.charCodeAt(index + 1)];
      const third = encoded[index + 2] === "=" ? 0 : BASE64_VALUES[encoded.charCodeAt(index + 2)];
      const fourth = encoded[index + 3] === "=" ? 0 : BASE64_VALUES[encoded.charCodeAt(index + 3)];
      bytes[offset++] = (first << 2) | (second >> 4);
      if (offset < bytes.length) bytes[offset++] = ((second & 15) << 4) | (third >> 2);
      if (offset < bytes.length) bytes[offset++] = ((third & 3) << 6) | fourth;
    }
    return bytes;
  };

  const decodeUtf8 = (bytes, fatal = false, ignoreBOM = false) => {
    let output = "";
    let units = [];
    let atStart = true;
    const flush = () => {
      if (units.length > 0) { output += String.fromCharCode(...units); units = []; }
    };
    const emit = (codePoint) => {
      if (atStart) {
        atStart = false;
        if (codePoint === 0xFEFF && !ignoreBOM) return;
      }
      if (codePoint <= 0xFFFF) units.push(codePoint);
      else {
        const value = codePoint - 0x10000;
        units.push(0xD800 + (value >> 10), 0xDC00 + (value & 0x3FF));
      }
      if (units.length >= 8_192) flush();
    };
    const invalid = () => {
      if (fatal) throw new TypeError("The encoded data was not valid UTF-8");
      emit(0xFFFD);
    };
    const continuation = (value) => value >= 0x80 && value <= 0xBF;
    for (let index = 0; index < bytes.length;) {
      const first = bytes[index];
      if (first <= 0x7F) { emit(first); index++; continue; }
      let length = 0;
      let codePoint = 0;
      let minimumSecond = 0x80;
      let maximumSecond = 0xBF;
      if (first >= 0xC2 && first <= 0xDF) { length = 2; codePoint = first & 0x1F; }
      else if (first >= 0xE0 && first <= 0xEF) {
        length = 3; codePoint = first & 0x0F;
        if (first === 0xE0) minimumSecond = 0xA0;
        if (first === 0xED) maximumSecond = 0x9F;
      } else if (first >= 0xF0 && first <= 0xF4) {
        length = 4; codePoint = first & 0x07;
        if (first === 0xF0) minimumSecond = 0x90;
        if (first === 0xF4) maximumSecond = 0x8F;
      } else { invalid(); index++; continue; }
      if (index + length > bytes.length) { invalid(); break; }
      const second = bytes[index + 1];
      if (second < minimumSecond || second > maximumSecond) { invalid(); index++; continue; }
      let valid = true;
      for (let offset = 2; offset < length; offset++) valid &&= continuation(bytes[index + offset]);
      if (!valid) { invalid(); index++; continue; }
      for (let offset = 1; offset < length; offset++) codePoint = (codePoint << 6) | (bytes[index + offset] & 0x3F);
      emit(codePoint);
      index += length;
    }
    flush();
    return output;
  };

  class RuntimeTextEncoder {
    get encoding() { return "utf-8"; }
    encode(value = "") {
      return base64ToBytes(webOperation("textEncode", { value: String(value) }));
    }
    encodeInto(value, destination) {
      if (!(destination instanceof Uint8Array)) throw new TypeError("TextEncoder.encodeInto destination must be a Uint8Array");
      const encoded = webOperation("textEncodeInto", { value: String(value), length: destination.byteLength });
      destination.set(base64ToBytes(encoded.bytes));
      return { read: encoded.read, written: encoded.written };
    }
  }

  class RuntimeTextDecoder {
    constructor(label = "utf-8", options = {}) {
      const decoder = webOperation("textDecoderCreate", { label: String(label), options });
      Object.defineProperties(this, {
        _id: { value: decoder.id },
        encoding: { enumerable: true, value: decoder.encoding },
        fatal: { enumerable: true, value: decoder.fatal },
        ignoreBOM: { enumerable: true, value: decoder.ignoreBOM },
      });
    }
    decode(input = new Uint8Array(), options = {}) {
      let bytes;
      if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
      else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      else throw new TypeError("TextDecoder.decode input must be an ArrayBuffer or an ArrayBuffer view");
      if (this.encoding === "utf-8" && !options.stream) {
        return decodeUtf8(bytes, this.fatal, this.ignoreBOM);
      }
      const decoded = webOperation("textDecode", { id: this._id, bytes: bytesToBase64(bytes), options });
      return decodeUtf8(base64ToBytes(decoded.bytes), false, true);
    }
  }

  class RuntimeURLSearchParams {
    constructor(init = "", onChange) {
      let initial;
      if (init instanceof RuntimeURLSearchParams) initial = { query: init.toString() };
      else if (typeof init === "string") initial = { query: init.startsWith("?") ? init.slice(1) : init };
      else if (init != null && typeof init[Symbol.iterator] === "function") initial = { initPairs: Array.from(init, (pair) => Array.from(pair, String)) };
      else if (init != null && typeof init === "object") initial = { initPairs: Object.entries(init).map(([name, value]) => [name, String(value)]) };
      else initial = { query: String(init ?? "") };
      this._onChange = typeof onChange === "function" ? onChange : undefined;
      this._replace(webOperation("searchParams", { ...initial, operation: "snapshot" }));
    }
    _replace(snapshot) {
      this._query = snapshot.query;
      this._pairs = snapshot.pairs;
    }
    _run(operation, values = []) {
      const snapshot = webOperation("searchParams", { query: this._query, operation, values });
      this._replace(snapshot);
      if (["append", "delete", "set", "sort"].includes(operation)) this._onChange?.(this._query);
      return snapshot.result;
    }
    get size() { return this._pairs.length; }
    append(name, value) { this._run("append", [name, value]); }
    delete(name, value) { this._run("delete", arguments.length > 1 ? [name, value] : [name]); }
    get(name) { return this._run("get", [name]); }
    getAll(name) { return this._run("getAll", [name]); }
    has(name, value) { return this._run("has", arguments.length > 1 ? [name, value] : [name]); }
    set(name, value) { this._run("set", [name, value]); }
    sort() { this._run("sort"); }
    entries() { return this._pairs.map((pair) => [...pair])[Symbol.iterator](); }
    keys() { return this._pairs.map(([name]) => name)[Symbol.iterator](); }
    values() { return this._pairs.map(([, value]) => value)[Symbol.iterator](); }
    forEach(callback, thisArg) {
      if (typeof callback !== "function") throw new TypeError("URLSearchParams.forEach callback must be a function");
      for (const [name, value] of this._pairs) callback.call(thisArg, value, name, this);
    }
    toString() { return this._query; }
    [Symbol.iterator]() { return this.entries(); }
  }
  Object.defineProperty(RuntimeURLSearchParams.prototype, Symbol.toStringTag, { value: "URLSearchParams" });

  class RuntimeURL {
    constructor(input, base) {
      this._setParts(webOperation("url", {
        input: String(input),
        ...(base === undefined ? {} : { base: String(base) }),
      }));
      this._searchParams = new RuntimeURLSearchParams(this.search, (query) => {
        this._set("search", query ? "?" + query : "");
      });
    }
    _setParts(parts) {
      for (const [name, value] of Object.entries(parts)) this["_" + name] = value;
      if (this._searchParams) this._searchParams._replace(webOperation("searchParams", {
        query: this._search,
        operation: "snapshot",
      }));
    }
    _set(name, value) {
      this._setParts(webOperation("url", { input: this._href, set: [name, String(value)] }));
    }
    get href() { return this._href; } set href(value) { this._set("href", value); }
    get origin() { return this._origin; }
    get protocol() { return this._protocol; } set protocol(value) { this._set("protocol", value); }
    get username() { return this._username; } set username(value) { this._set("username", value); }
    get password() { return this._password; } set password(value) { this._set("password", value); }
    get host() { return this._host; } set host(value) { this._set("host", value); }
    get hostname() { return this._hostname; } set hostname(value) { this._set("hostname", value); }
    get port() { return this._port; } set port(value) { this._set("port", value); }
    get pathname() { return this._pathname; } set pathname(value) { this._set("pathname", value); }
    get search() { return this._search; } set search(value) { this._set("search", value); }
    get searchParams() { return this._searchParams; }
    get hash() { return this._hash; } set hash(value) { this._set("hash", value); }
    toString() { return this._href; }
    toJSON() { return this._href; }
    static canParse(input, base) {
      return webOperation("urlCanParse", { input: String(input), ...(base === undefined ? {} : { base: String(base) }) });
    }
    static parse(input, base) {
      try { return new RuntimeURL(input, base); } catch { return null; }
    }
  }
  Object.defineProperty(RuntimeURL.prototype, Symbol.toStringTag, { value: "URL" });

  const headerPairs = (init) => {
    if (init instanceof RuntimeHeaders) return [...init];
    if (init == null) return [];
    if (typeof init[Symbol.iterator] === "function") return Array.from(init, (pair) => Array.from(pair, String));
    if (typeof init === "object") return Object.entries(init).map(([name, value]) => [name, String(value)]);
    throw new TypeError("Headers initializer must be a record or iterable");
  };

  class RuntimeHeaders {
    constructor(init) {
      this._replace(webOperation("headers", { pairs: headerPairs(init), operation: "snapshot" }));
    }
    _replace(snapshot) { this._pairs = snapshot.pairs; }
    _run(operation, values = []) {
      const snapshot = webOperation("headers", { pairs: this._pairs, operation, values });
      this._replace(snapshot);
      return snapshot.result;
    }
    append(name, value) { this._run("append", [name, value]); }
    delete(name) { this._run("delete", [name]); }
    get(name) { return this._run("get", [name]); }
    getSetCookie() { return this._run("getSetCookie"); }
    has(name) { return this._run("has", [name]); }
    set(name, value) { this._run("set", [name, value]); }
    entries() { return this._pairs.map((pair) => [...pair])[Symbol.iterator](); }
    keys() { return this._pairs.map(([name]) => name)[Symbol.iterator](); }
    values() { return this._pairs.map(([, value]) => value)[Symbol.iterator](); }
    forEach(callback, thisArg) {
      if (typeof callback !== "function") throw new TypeError("Headers.forEach callback must be a function");
      for (const [name, value] of this._pairs) callback.call(thisArg, value, name, this);
    }
    [Symbol.iterator]() { return this.entries(); }
  }
  Object.defineProperty(RuntimeHeaders.prototype, Symbol.toStringTag, { value: "Headers" });

  class RuntimeDOMException extends Error {
    constructor(message = "", name = "Error") { super(message); this.name = name; }
  }

  class RuntimeAbortSignal {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = new Set();
    }
    addEventListener(type, listener, options = {}) {
      if (type !== "abort" || (typeof listener !== "function" && typeof listener?.handleEvent !== "function")) return;
      this._listeners.add({ listener, once: Boolean(options && options.once) });
    }
    removeEventListener(type, listener) {
      if (type !== "abort") return;
      for (const entry of this._listeners) if (entry.listener === listener) this._listeners.delete(entry);
    }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    _abort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason === undefined ? new RuntimeDOMException("This operation was aborted", "AbortError") : reason;
      const event = Object.freeze({ type: "abort", target: this, currentTarget: this });
      let listenerError;
      const notify = (listener) => {
        try {
          if (typeof listener === "function") listener.call(this, event);
          else listener.handleEvent(event);
        } catch (error) {
          listenerError ??= error;
        }
      };
      if (typeof this.onabort === "function") notify(this.onabort);
      for (const entry of [...this._listeners]) {
        if (entry.once) this._listeners.delete(entry);
        notify(entry.listener);
      }
      if (listenerError !== undefined) scheduleTimeout(() => { throw listenerError; }, 0);
    }
    static abort(reason) { const signal = new RuntimeAbortSignal(); signal._abort(reason); return signal; }
    static timeout(milliseconds) {
      const delay = Number(milliseconds);
      if (!Number.isFinite(delay) || delay < 0) throw new RangeError("AbortSignal timeout must be a non-negative finite number");
      const signal = new RuntimeAbortSignal();
      scheduleTimeout(() => signal._abort(new RuntimeDOMException("The operation timed out", "TimeoutError")), delay);
      return signal;
    }
    static any(signals) {
      const values = Array.from(signals);
      if (values.some((signal) => !(signal instanceof RuntimeAbortSignal))) throw new TypeError("AbortSignal.any expects AbortSignal values");
      const combined = new RuntimeAbortSignal();
      for (const signal of values) {
        if (signal.aborted) { combined._abort(signal.reason); break; }
        signal.addEventListener("abort", () => combined._abort(signal.reason), { once: true });
      }
      return combined;
    }
  }
  Object.defineProperty(RuntimeAbortSignal.prototype, Symbol.toStringTag, { value: "AbortSignal" });

  class RuntimeAbortController {
    constructor() { this.signal = new RuntimeAbortSignal(); }
    abort(reason) { this.signal._abort(reason); }
  }
  Object.defineProperty(RuntimeAbortController.prototype, Symbol.toStringTag, { value: "AbortController" });

  const MAX_FETCH_BODY_BYTES = 10 * 1_024 * 1_024;
  const runtimeBodies = new WeakMap();
  const webWeakMapGet = WeakMap.prototype.get;
  const webWeakMapSet = WeakMap.prototype.set;
  const webApplyFunction = Reflect.apply;
  const getRuntimeBody = (owner) => webApplyFunction(webWeakMapGet, runtimeBodies, [owner]);
  const setRuntimeBody = (owner, bytes) => webApplyFunction(webWeakMapSet, runtimeBodies, [owner, bytes]);
  const copyBytes = (value) => {
    let bytes;
    if (value == null) return undefined;
    if (typeof value === "string") bytes = new RuntimeTextEncoder().encode(value);
    else if (value instanceof RuntimeURLSearchParams) bytes = new RuntimeTextEncoder().encode(value.toString());
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    else throw new TypeError("Body must be a string, URLSearchParams, ArrayBuffer, or ArrayBuffer view");
    if (bytes.byteLength > MAX_FETCH_BODY_BYTES) {
      throw new RangeError("fetch request exceeds 10,485,760 bytes");
    }
    return bytes;
  };

  class RuntimeBody {
    _setBody(value) { setRuntimeBody(this, copyBytes(value)); this.bodyUsed = false; }
    _consume() {
      if (this.bodyUsed) return Promise.reject(new TypeError("Body has already been consumed"));
      this.bodyUsed = true;
      const bytes = getRuntimeBody(this);
      return Promise.resolve(bytes ? bytes.slice() : new Uint8Array());
    }
    async arrayBuffer() {
      const bytes = await this._consume();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    async bytes() { return this._consume(); }
    async text() { return new RuntimeTextDecoder().decode(await this._consume()); }
    async json() { return JSON.parse(await this.text()); }
  }

  class RuntimeRequest extends RuntimeBody {
    constructor(input, init = {}) {
      super();
      const source = input instanceof RuntimeRequest ? input : undefined;
      this.url = new RuntimeURL(source ? source.url : String(input)).href;
      this.method = String(init.method ?? source?.method ?? "GET").toUpperCase();
      this.headers = new RuntimeHeaders(init.headers ?? source?.headers);
      this.redirect = String(init.redirect ?? source?.redirect ?? "follow");
      this.signal = init.signal ?? source?.signal ?? new RuntimeAbortSignal();
      if (!(this.signal instanceof RuntimeAbortSignal)) throw new TypeError("Request signal must be an AbortSignal");
      const body = init.body !== undefined ? init.body : source ? getRuntimeBody(source) : undefined;
      this._setBody(body);
      if (body instanceof RuntimeURLSearchParams && !this.headers.has("content-type")) {
        this.headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
      } else if (typeof body === "string" && !this.headers.has("content-type")) {
        this.headers.set("content-type", "text/plain;charset=UTF-8");
      }
    }
    clone() {
      if (this.bodyUsed) throw new TypeError("Cannot clone a consumed Request");
      return new RuntimeRequest(this);
    }
  }
  Object.defineProperty(RuntimeRequest.prototype, Symbol.toStringTag, { value: "Request" });

  class RuntimeResponse extends RuntimeBody {
    constructor(body = null, init = {}) {
      super();
      this.status = Number(init.status ?? 200);
      this.statusText = String(init.statusText ?? "");
      this.headers = new RuntimeHeaders(init.headers);
      this.url = String(init.url ?? "");
      this.redirected = Boolean(init.redirected);
      this.type = String(init.type ?? "default");
      this._setBody(body);
    }
    get ok() { return this.status >= 200 && this.status <= 299; }
    clone() {
      if (this.bodyUsed) throw new TypeError("Cannot clone a consumed Response");
      return new RuntimeResponse(getRuntimeBody(this), {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
        url: this.url,
        redirected: this.redirected,
        type: this.type,
      });
    }
    static error() { return new RuntimeResponse(null, { status: 0, type: "error" }); }
    static json(value, init = {}) {
      const headers = new RuntimeHeaders(init.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new RuntimeResponse(JSON.stringify(value), { ...init, headers });
    }
    static redirect(url, status = 302) {
      const code = Number(status);
      if (![301, 302, 303, 307, 308].includes(code)) throw new RangeError("Invalid redirect status");
      return new RuntimeResponse(null, { status: code, headers: { location: new RuntimeURL(url).href } });
    }
    static _fromFetch(snapshot) {
      return new RuntimeResponse(base64ToBytes(snapshot.body), snapshot);
    }
  }
  Object.defineProperty(RuntimeResponse.prototype, Symbol.toStringTag, { value: "Response" });

  const snapshotRequest = (request) => {
    const body = getRuntimeBody(request);
    return {
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      redirect: request.redirect,
      ...(body === undefined ? {} : { body: bytesToBase64(body) }),
    };
  };

  const runtimeFetch = async (input, init = {}) => {
    const source = input instanceof RuntimeRequest ? input : undefined;
    if (source?.bodyUsed) throw new TypeError("Body has already been consumed");
    const request = new RuntimeRequest(input, init);
    if (source && getRuntimeBody(source) !== undefined && init.body === undefined) source.bodyUsed = true;
    request.signal.throwIfAborted();
    const pendingFetch = call("fetch", snapshotRequest(request));
    const abort = () => cancelCall(pendingFetch, request.signal.reason && request.signal.reason.message
      ? request.signal.reason.message
      : "fetch aborted");
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const snapshot = await pendingFetch;
      return RuntimeResponse._fromFetch(snapshot);
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason;
      throw error;
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  };

  const runtimeStructuredClone = (value, options = {}) => {
    if (options && Array.isArray(options.transfer) && options.transfer.length > 0) {
      throw new RuntimeDOMException("Transfer lists are not supported in pi_exec", "DataCloneError");
    }
    const seen = new Map();
    const clone = (source) => {
      if (source === null || typeof source !== "object") {
        if (typeof source === "function" || typeof source === "symbol") throw new RuntimeDOMException("Value is not cloneable", "DataCloneError");
        return source;
      }
      if (seen.has(source)) return seen.get(source);
      if (source instanceof Date) return new Date(source.getTime());
      if (source instanceof RegExp) return new RegExp(source.source, source.flags);
      if (source instanceof ArrayBuffer) return source.slice(0);
      if (ArrayBuffer.isView(source)) {
        if (source instanceof DataView) return new DataView(clone(source.buffer), source.byteOffset, source.byteLength);
        return new source.constructor(source);
      }
      if (source instanceof Map) {
        const result = new Map(); seen.set(source, result);
        for (const [key, nested] of source) result.set(clone(key), clone(nested));
        return result;
      }
      if (source instanceof Set) {
        const result = new Set(); seen.set(source, result);
        for (const nested of source) result.add(clone(nested));
        return result;
      }
      if (source instanceof Error) {
        const result = new Error(source.message); seen.set(source, result);
        result.name = source.name; if (source.stack) result.stack = source.stack;
        if ("cause" in source) result.cause = clone(source.cause);
        return result;
      }
      const result = Array.isArray(source) ? [] : {};
      seen.set(source, result);
      for (const key of Object.keys(source)) result[key] = clone(source[key]);
      return result;
    };
    return clone(value);
  };

  globalThis.fetch = runtimeFetch;
  globalThis.URL = RuntimeURL;
  globalThis.URLSearchParams = RuntimeURLSearchParams;
  globalThis.Headers = RuntimeHeaders;
  globalThis.Request = RuntimeRequest;
  globalThis.Response = RuntimeResponse;
  globalThis.AbortController = RuntimeAbortController;
  globalThis.AbortSignal = RuntimeAbortSignal;
  globalThis.DOMException = RuntimeDOMException;
  globalThis.TextEncoder = RuntimeTextEncoder;
  globalThis.TextDecoder = RuntimeTextDecoder;
  globalThis.atob = (value) => webOperation("atob", { value: String(value) });
  globalThis.btoa = (value) => webOperation("btoa", { value: String(value) });
  globalThis.structuredClone = runtimeStructuredClone;
  globalThis.queueMicrotask = (callback) => {
    if (typeof callback !== "function") throw new TypeError("queueMicrotask callback must be a function");
    Promise.resolve().then(callback);
  };
`;
