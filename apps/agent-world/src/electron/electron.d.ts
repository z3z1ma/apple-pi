// The part of Electron's API that Agent World uses. Electron is installed on first launch, not as a dependency of
// apple-pi (docs/adr/0001-agent-world-runtime.md), so its own type definitions are not installed; extend this when
// the app needs more.
declare module "electron" {
	interface NativeImage {
		toPNG(): Buffer;
	}

	interface WebContents {
		send(channel: string, ...args: unknown[]): void;
		setWindowOpenHandler(handler: () => { action: "deny" | "allow" }): void;
		on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): this;
		once(event: "did-finish-load", listener: () => void): this;
		capturePage(): Promise<NativeImage>;
		executeJavaScript(code: string): Promise<unknown>;
		getUserAgent(): string;
		setUserAgent(userAgent: string): void;
		readonly session: {
			readonly cookies: { get(filter: { url?: string; name?: string }): Promise<{ name: string; value: string }[]> };
		};
	}

	export class BrowserWindow {
		constructor(options: {
			width: number;
			height: number;
			title: string;
			backgroundColor: string;
			webPreferences: {
				preload?: string;
				partition?: string;
				contextIsolation: boolean;
				sandbox: boolean;
				nodeIntegration: boolean;
			};
		});
		readonly webContents: WebContents;
		loadURL(url: string): Promise<void>;
		isDestroyed(): boolean;
		isMinimized(): boolean;
		restore(): void;
		show(): void;
		focus(): void;
		on(event: "closed", listener: () => void): this;
		once(event: "closed", listener: () => void): this;
		close(): void;
	}

	export const app: {
		setName(name: string): void;
		setPath(name: "userData", path: string): void;
		requestSingleInstanceLock(): boolean;
		whenReady(): Promise<void>;
		quit(): void;
		on(event: "second-instance" | "window-all-closed" | "will-quit", listener: () => void): void;
	};

	export const ipcMain: {
		handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
	};

	export const shell: {
		openExternal(url: string): Promise<void>;
	};

	export const net: {
		fetch(url: string): Promise<Response>;
	};

	export const protocol: {
		registerSchemesAsPrivileged(
			schemes: { scheme: string; privileges: { standard?: boolean; secure?: boolean; supportFetchAPI?: boolean } }[],
		): void;
		handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
	};

	export const contextBridge: {
		exposeInMainWorld(key: string, api: unknown): void;
	};

	export const ipcRenderer: {
		invoke(channel: string, ...args: unknown[]): Promise<unknown>;
		on(channel: string, listener: (event: unknown, ...args: any[]) => void): void;
		removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): void;
	};
}
