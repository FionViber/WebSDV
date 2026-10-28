const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loading-title");
const loadingDetail = document.getElementById("loading-detail");
const loadingFill = document.getElementById("loading-fill");
const loadingBar = document.getElementById("loading-bar");
const canvas = document.getElementById("canvas");

function setLoading(title, detail = "", progress = null) {
	loadingTitle.textContent = title;
	loadingDetail.textContent = detail;
	const value = progress === null ? 0 : Math.max(0, Math.min(1, progress));
	loadingFill.style.transform = `scaleX(${value})`;
	loadingBar.setAttribute("aria-valuenow", String(Math.round(value * 100)));
}

window.addEventListener("unhandledrejection", (event) => {
	console.error(event.reason);
	const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
	setLoading("Game loading failed", `${message} · Refresh the page to try again.`);
	event.preventDefault();
});
window.addEventListener("error", (event) => {
	if (!loading.classList.contains("hidden")) {
		console.error(event.error ?? event.message);
		setLoading("Game loading failed", `${event.message || "Unknown error"} · Refresh the page to try again.`);
	}
});

window.__sdvLoaderStarted = true;
clearTimeout(window.__sdvLoaderStartupTimer);
setLoading("Preparing game", "Loading the .NET runtime and game resources");

// OPFS keeps the large archives out of the JavaScript heap after download.
// Each archive entry is then copied into the game's filesystem one file at a time.
let opfs = null;
try {
	opfs = await navigator.storage?.getDirectory?.() ?? null;
} catch {
	opfs = null;
}
void navigator.storage?.persist?.().catch(() => false);

async function opfsRead(name) {
	if (!opfs) throw new Error("Browser storage is unavailable");
	return new Uint8Array(await (await (await opfs.getFileHandle(name)).getFile()).arrayBuffer());
}

async function opfsGetFile(name) {
	if (!opfs) throw new Error("Browser storage is unavailable");
	return (await opfs.getFileHandle(name)).getFile();
}

async function fetchChunkCount(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
	const text = (await response.text()).trim();
	if (!/^\d+$/.test(text) || Number(text) < 1)
		throw new Error(`Invalid chunk count in ${url}: ${JSON.stringify(text)}`);
	return Number(text);
}

const chunkProgress = new Map();
let totalChunks = 0;
let completedChunks = 0;
const DOWNLOAD_PROGRESS_WEIGHT = 0.4;

function downloadProgress() {
	return totalChunks ? DOWNLOAD_PROGRESS_WEIGHT * completedChunks / totalChunks : 0;
}

function markChunkComplete(label, count) {
	const state = chunkProgress.get(label);
	if (!state) return;
	state.completed = Math.max(state.completed, count);
	completedChunks = [...chunkProgress.values()].reduce((sum, item) => sum + item.completed, 0);
	setLoading("Loading game resources", `${label} · ${state.completed} / ${state.total} parts`, downloadProgress());
}

async function readTarChunks(base, label, writeChunk, count) {
	const state = chunkProgress.get(label);
	for (let i = 0; i < count; i++) {
		setLoading("Loading game resources", `${label} · ${i + 1} / ${count} parts`, downloadProgress());
		const response = await fetch(`${base}${String(i).padStart(2, "0")}`);
		if (!response.ok) throw new Error(`Failed to fetch ${response.url}: HTTP ${response.status}`);
		if (!response.body) throw new Error(`Streaming response body unavailable for ${response.url}`);
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			await writeChunk(value);
		}
		state.completed++;
		completedChunks++;
		setLoading("Loading game resources", `${label} · ${state.completed} / ${count} parts`, downloadProgress());
	}
}

async function downloadTarToBlob(base, label, count) {
	const chunks = [];
	await readTarChunks(base, label, (chunk) => { chunks.push(chunk); }, count);
	const archive = new Blob(chunks, { type: "application/x-tar" });
	chunks.length = 0;
	return archive;
}

async function downloadAndCacheTar(base, label, key, count) {
	if (opfs) {
		let writer;
		try {
			writer = await (await opfs.getFileHandle(key, { create: true })).createWritable();
			await readTarChunks(base, label, (chunk) => writer.write(chunk), count);
			await writer.close();
			const archive = await opfsGetFile(key);
			return { archive, entries: await parseTar(archive) };
		} catch {
			try { await writer?.abort(); } catch {}
			try { await opfs.removeEntry(key); } catch {}
			const state = chunkProgress.get(label);
			if (state) state.completed = 0;
			completedChunks = [...chunkProgress.values()].reduce((sum, item) => sum + item.completed, 0);
		}
	}
	const archive = await downloadTarToBlob(base, label, count);
	return { archive, entries: await parseTar(archive) };
}

async function getTar(base, label, key, count) {
	if (opfs) {
		try {
			const cached = await opfsGetFile(key);
			if (cached.size > 0) {
				const entries = await parseTar(cached);
				markChunkComplete(label, count);
				return { archive: cached, entries };
			}
		} catch {
			try { await opfs.removeEntry(key); } catch {}
		}
	}
	return downloadAndCacheTar(base, label, key, count);
}

// Runtime startup happens alongside the two complete resource downloads.
const runtimeP = (async () => {
	const { dotnet } = await import("./_framework/dotnet.js");
	return dotnet
		.withApplicationCulture("en-US")
		.withModuleConfig({ canvas })
		.withEnvironmentVariable("MONO_SLEEP_ABORT_LIMIT", "99999")
		.withRuntimeOptions([
			`--jiterpreter-minimum-trace-hit-count=${500}`,
			`--jiterpreter-trace-monitoring-period=${100}`,
			`--jiterpreter-trace-monitoring-max-average-penalty=${150}`,
			`--jiterpreter-wasm-bytes-limit=${64 * 1024 * 1024}`,
			`--jiterpreter-table-size=${32 * 1024}`,
		])
		.withResourceLoader((type, _name, defaultUri, _integrity, behavior) => {
			if (type === "dotnetwasm" && behavior === "dotnetwasm") {
				return (async () => {
					const count = await fetchChunkCount(defaultUri + ".count");
					let idx = 0;
					const fetchNext = async () => {
						if (idx >= count) return null;
						const uri = defaultUri + idx;
						const response = await fetch(uri);
						idx++;
						if (!response.ok) throw new Error(`Failed to fetch ${uri}: HTTP ${response.status}`);
						if (!response.body) throw new Error(`Streaming response body unavailable for ${uri}`);
						return response.body.getReader();
					};
					let current = await fetchNext();
					if (!current) throw new Error("failed to fetch first wasm chunk");
					return new Response(new ReadableStream({
						async pull(controller) {
							const { value, done } = await current.read();
							if (done || !value) {
								current = await fetchNext();
								if (current) await this.pull(controller);
								else controller.close();
							} else controller.enqueue(value);
						},
					}), { headers: { "Content-Type": "application/wasm" } });
				})();
			}
		})
		.create();
})();

const [contentChunkCount, audioChunkCount] = await Promise.all([
	fetchChunkCount("Content.tar.count"),
	fetchChunkCount("ContentAudio.tar.count"),
]);
chunkProgress.set("Game Content", { total: contentChunkCount, completed: 0 });
chunkProgress.set("Music and Sound Effects", { total: audioChunkCount, completed: 0 });
totalChunks = contentChunkCount + audioChunkCount;

const [contentResult, audioResult, runtime] = await Promise.all([
	getTar("Content.tar", "Game Content", "Content-1.6.15-24354.tar", contentChunkCount),
	getTar("ContentAudio.tar", "Music and Sound Effects", "ContentAudio-1.6.15-24354.tar", audioChunkCount),
	runtimeP,
]);
let contentArchive = contentResult.archive;
let audioArchive = audioResult.archive;
const contentEntries = contentResult.entries;
const audioEntries = audioResult.entries;
const game = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);

function readTarString(buffer, offset, length, decoder) {
	let end = offset;
	while (end < offset + length && buffer[end] !== 0) end++;
	return decoder.decode(buffer.subarray(offset, end));
}

function readTarOctal(buffer, offset, length, field, decoder) {
	const value = readTarString(buffer, offset, length, decoder).trim();
	if (!/^[0-7]+$/.test(value)) throw new Error(`Invalid tar ${field}: ${JSON.stringify(value)}`);
	const parsed = Number.parseInt(value, 8);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Tar ${field} is out of range`);
	return parsed;
}

// Validate archive headers and paths without copying the whole archive into RAM.
async function parseTar(archive) {
	if (!(archive instanceof Blob)) throw new TypeError("Tar archive isn't a Blob");
	const entries = [];
	const paths = new Set();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const fileSize = archive.size;
	let pos = 0;
	let foundEnd = false;
	while (pos + 512 <= fileSize) {
		const header = new Uint8Array(await archive.slice(pos, pos + 512).arrayBuffer());
		if (header.every((value) => value === 0)) {
			foundEnd = true;
			pos += 512;
			break;
		}

		const storedChecksum = readTarOctal(header, 148, 8, "checksum", decoder);
		let actualChecksum = 0;
		for (let index = 0; index < 512; index++)
			actualChecksum += index >= 148 && index < 156 ? 32 : header[index];
		if (storedChecksum !== actualChecksum)
			throw new Error(`Tar checksum mismatch at byte ${pos}`);

		const name = readTarString(header, 0, 100, decoder);
		const headerPrefix = readTarString(header, 345, 155, decoder);
		const fullName = headerPrefix ? `${headerPrefix}/${name}` : name;
		const size = readTarOctal(header, 124, 12, "size", decoder);
		const type = header[156];
		const isFile = type === 0 || type === 48;
		const isDirectory = type === 53;
		if (!isFile && !isDirectory) throw new Error(`Unsupported tar entry type ${type} for ${fullName}`);
		if (isDirectory && size !== 0) throw new Error(`Tar directory has data: ${fullName}`);
		if (isFile && fullName.endsWith("/")) throw new Error(`Tar file has a directory path: ${fullName}`);

		const path = fullName.endsWith("/") ? fullName.slice(0, -1) : fullName;
		const segments = path.split("/");
		if (!path || path.startsWith("/") || path.includes("\\") ||
			segments.some((segment) => !segment || segment === "." || segment === ".."))
			throw new Error(`Unsafe tar path: ${JSON.stringify(fullName)}`);
		if (paths.has(path)) throw new Error(`Duplicate tar path: ${JSON.stringify(path)}`);
		paths.add(path);

		const dataStart = pos + 512;
		const dataEnd = dataStart + size;
		const next = dataStart + Math.ceil(size / 512) * 512;
		if (!Number.isSafeInteger(next) || dataEnd > fileSize || next > fileSize)
			throw new Error(`Truncated tar entry: ${fullName}`);
		entries.push({ fullName: path, isDirectory, dataStart, dataEnd });
		pos = next;
	}
	if (!foundEnd) throw new Error("Tar archive has no complete end marker");

	// TAR archives pad the end with zero bytes. Check in small slices so the tail
	// validation never allocates a second copy of a large game archive.
	const tailChunkSize = 1024 * 1024;
	for (let offset = pos; offset < fileSize; offset += tailChunkSize) {
		const tail = new Uint8Array(await archive.slice(offset, Math.min(offset + tailChunkSize, fileSize)).arrayBuffer());
		if (tail.some((value) => value !== 0)) throw new Error("Tar archive contains data after its end marker");
	}
	return entries;
}

async function extractTar(archive, prefix, entries, onFileLoaded = null) {
	let count = 0;
	for (const entry of entries) {
		const target = entry.fullName.startsWith("__prefs__/")
			? "/libsdl/saves/" + entry.fullName.slice("__prefs__/".length)
			: prefix + entry.fullName;
		if (entry.isDirectory) {
			game.WasmBootstrap.CreateContentDirectory(target);
		} else {
			const data = new Uint8Array(await archive.slice(entry.dataStart, entry.dataEnd).arrayBuffer());
			game.WasmBootstrap.WriteContentFile(target, data);
			count++;
			if (onFileLoaded) onFileLoaded(count, entry.fullName);
		}
	}
	return count;
}

// Browsers require a user gesture before WebAudio can play the game's music.
setLoading("Starting game", "Preparing game files", DOWNLOAD_PROGRESS_WEIGHT);

await runtime.runMain();
await game.WasmBootstrap.PreInit();

	if (opfs) {
	// Restore browser-local saves and settings from earlier sessions.
	for (const [key, path] of [
		["Saves.tar", "/libsdl/saves/Saves/"],
		["DevicePreferences.tar", "/libsdl/saves/"],
	]) {
		try {
			const saved = new Blob([await opfsRead(key)], { type: "application/x-tar" });
			const entries = await parseTar(saved);
			await extractTar(saved, path, entries);
		} catch (error) {
			if (error?.name !== "NotFoundError") console.error(`Couldn't restore ${key}; archive was ignored:`, error);
		}
	}
}

setLoading("Checking game files", "Verifying the game file list", DOWNLOAD_PROGRESS_WEIGHT);
const totalFiles = [...contentEntries, ...audioEntries].filter((entry) => !entry.isDirectory).length;
let loadedFiles = 0;
const FILE_PROGRESS_START = DOWNLOAD_PROGRESS_WEIGHT;
const FILE_PROGRESS_WEIGHT = 0.55;
setLoading("Loading game files", `0 / ${totalFiles} files`, FILE_PROGRESS_START);

const showFileProgress = (_archiveCount, fileName) => {
	loadedFiles++;
	const fileProgress = totalFiles ? loadedFiles / totalFiles : 1;
	setLoading("Loading game files", `${loadedFiles} / ${totalFiles} files · ${fileName}`, FILE_PROGRESS_START + FILE_PROGRESS_WEIGHT * fileProgress);
};
await extractTar(contentArchive, "/libsdl/", contentEntries, showFileProgress);
await extractTar(audioArchive, "/libsdl/", audioEntries, showFileProgress);

// The archive copies are no longer needed; the running game now owns the files.
contentArchive = null;
audioArchive = null;
contentResult.archive = null;
audioResult.archive = null;

setLoading("Starting game", "Initializing graphics", FILE_PROGRESS_START + FILE_PROGRESS_WEIGHT);
const dpr = window.devicePixelRatio || 1;
const w = Math.round(canvas.clientWidth * dpr) || 1280;
const h = Math.round(canvas.clientHeight * dpr) || 720;
await game.WasmBootstrap.Init(w, h);

new ResizeObserver(() => {
	const dpr = window.devicePixelRatio || 1;
	const nw = Math.round(canvas.clientWidth * dpr);
	const nh = Math.round(canvas.clientHeight * dpr);
	if (nw > 0 && nh > 0) try { game.WasmBootstrap.Resize(nw, nh); } catch {}
}).observe(canvas);

try { void navigator.keyboard?.lock().catch(() => {}); } catch {}
document.addEventListener("keydown", (event) => {
	if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(event.code))
		event.preventDefault();
});

setLoading("Starting game", "Loading complete", 1);
loading.classList.add("hidden");
try {
	await game.WasmBootstrap.MainLoop();
} catch (error) {
	if (error !== "unwind" && error?.message !== "unwind") throw error;
}
