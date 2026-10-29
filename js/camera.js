// Asks the camera for its default picture. The app accepts whatever picture the camera
// gives, and the models fit any size into their 640px square.

let stream = null;

export async function startCamera(videoEl) {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error(
			"Camera not available. The page must be served over HTTPS.",
		);
	}

	stream = await navigator.mediaDevices.getUserMedia({
		video: { facingMode: { ideal: "environment" } },
		audio: false,
	});

	videoEl.srcObject = stream;
	await videoEl.play();
	if (!videoEl.videoWidth) {
		await new Promise((resolve) => {
			videoEl.onloadedmetadata = () => resolve();
		});
	}
}

export function stopCamera(videoEl) {
	if (stream) {
		stream.getTracks().forEach((t) => t.stop());
		stream = null;
	}
	videoEl.srcObject = null;
}

// The ESP32 camera, through serve.py on the same address as the app.
export function startEsp32(imgEl) {
	imgEl.src = "/stream";
}

export function stopEsp32(imgEl) {
	imgEl.removeAttribute("src");
}

// True once a picture is available, for either the video element or the ESP32 image.
export function frameReady(el) {
	return el.tagName === "IMG" ? el.naturalWidth > 0 : el.readyState >= 2;
}

// Width and height of the picture, for either the video element or the ESP32 image.
export function frameSize(el) {
	return el.tagName === "IMG"
		? { w: el.naturalWidth, h: el.naturalHeight }
		: { w: el.videoWidth, h: el.videoHeight };
}
