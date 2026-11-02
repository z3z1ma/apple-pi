import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

const workerTypes = new Map<string, new () => Worker>([
	["json", JsonWorker],
	["css", CssWorker],
	["scss", CssWorker],
	["less", CssWorker],
	["html", HtmlWorker],
	["handlebars", HtmlWorker],
	["razor", HtmlWorker],
	["typescript", TypeScriptWorker],
	["javascript", TypeScriptWorker],
]);
const workers = new Set<Worker>();
self.MonacoEnvironment = {
	getWorker(_moduleId: string, label: string) {
		const WorkerType = workerTypes.get(label) ?? EditorWorker;
		const worker = new WorkerType();
		workers.add(worker);
		return worker;
	},
};

export function disposeWorkers() {
	for (const worker of workers) worker.terminate();
	workers.clear();
}

export { monaco };
