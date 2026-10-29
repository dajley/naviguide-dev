// NaViGuide service worker: makes the app run offline.
//
// Two caches:
//   SHELL_CACHE  - app code (html, css, js, icons). Network first, so online
//                  users always get the latest code; falls back to cache offline.
//   ASSET_CACHE  - large immutable files (ONNX models, vendored ONNX Runtime).
//                  Cache first. Only changes when ASSET_VERSION is bumped.
//
// When you change app files, bump SHELL_VERSION so the install step re-caches
// the shell. When you change a model or the vendored runtime, bump ASSET_VERSION.

const SHELL_VERSION = "v2";
const ASSET_VERSION = "v2";
const SHELL_CACHE = `naviguide-shell-${SHELL_VERSION}`;
const ASSET_CACHE = `naviguide-assets-${ASSET_VERSION}`;

// Every app file the page needs. Keep this list in sync with the js/ folder.
const SHELL_FILES = [
	"./",
	"./index.html",
	"./manifest.webmanifest",
	"./css/styles.css",
	"./js/main.js",
	"./js/alerts.js",
	"./js/camera.js",
	"./js/config.js",
	"./js/depth.js",
	"./js/detect.js",
	"./js/geometry.js",
	"./js/intro.js",
	"./js/navigation.js",
	"./js/overlay.js",
	"./js/scene.js",
	"./js/sem.js",
	"./js/speech.js",
	"./js/worker.js",
	"./js/worker-core.js",
	"./js/voice.js",
	"./icons/naviguide-icon-192.png",
	"./icons/naviguide-icon-512.png",
];

const ASSET_FILES = [
	"./js/vendor/ort/ort.webgpu.min.js",
	"./js/vendor/ort/ort-wasm-simd-threaded.jsep.mjs",
	"./js/vendor/ort/ort-wasm-simd-threaded.jsep.wasm",
	"./models/yolo26n-seg.onnx",
	"./models/yolo26n-depth.onnx",
	"./models/yolo26n-sem-ade20k.onnx",
	"./js/vendor/moonshine/moonshine.min.js",
	"./js/vendor/moonshine/ort-wasm-simd-threaded.jsep.mjs",
	"./js/vendor/moonshine/ort-wasm-simd-threaded.jsep.wasm",
	"./js/vendor/moonshine/silero_vad_v5.onnx",
	"./models/moonshine-base/quantized/decoder_model_merged.onnx",
	"./models/moonshine-base/quantized/encoder_model.onnx",
];

const ASSET_PATH = /\/(models|js\/vendor)\//;

function absolute(path) {
	return new URL(path, self.registration.scope).href;
}

// Fetch with cache: "reload" so install never stores a stale HTTP-cached copy.
function fresh(path) {
	return new Request(absolute(path), { cache: "reload" });
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const shell = await caches.open(SHELL_CACHE);
			await shell.addAll(SHELL_FILES.map(fresh));

			const assets = await caches.open(ASSET_CACHE);
			for (const path of ASSET_FILES) {
				// Skip files already stored by an earlier install of the same version.
				if (await assets.match(absolute(path))) continue;
				await assets.add(fresh(path));
			}
		})(),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
			for (const key of await caches.keys()) {
				if (!keep.has(key)) await caches.delete(key);
			}
			await self.clients.claim();
		})(),
	);
});

async function cacheFirst(request) {
	const cache = await caches.open(ASSET_CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}

async function networkFirst(request) {
	const cache = await caches.open(SHELL_CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(request, response.clone());
		return response;
	} catch {
		const hit = await cache.match(request, { ignoreSearch: true });
		if (hit) return hit;
		if (request.mode === "navigate") {
			const index = await cache.match(absolute("./index.html"));
			if (index) return index;
		}
		return new Response("Offline and not cached.", {
			status: 503,
			headers: { "Content-Type": "text/plain" },
		});
	}
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return; // leave cross-origin alone

	if (ASSET_PATH.test(url.pathname)) {
		event.respondWith(cacheFirst(request));
	} else {
		event.respondWith(networkFirst(request));
	}
});
