// Web Worker that runs the models, so the main page stays free for the camera and overlay.
// Classic worker: loads ONNX Runtime with importScripts, then the model code as a module.
importScripts("../vendor/yolo26n/ort.webgpu.min.js");

let core = null;

self.onmessage = async (e) => {
	const msg = e.data;
	try {
		if (msg.type === "init") {
			core = await import("./worker-core.js");
			const backend = await core.init(msg.base);
			self.postMessage({ type: "ready", backend });
		} else if (msg.type === "frame") {
			const out = await core.processFrame(
				msg.bitmap,
				msg.reset,
				msg.vw,
				msg.vh,
			);
			// Send the semantic map as a transfer, not a copy.
			const transfer = out.sem ? [out.sem.data.buffer] : [];
			self.postMessage({ type: "result", ...out }, transfer);
		}
	} catch (err) {
		self.postMessage({ type: "error", message: String(err?.message ?? err) });
	}
};
