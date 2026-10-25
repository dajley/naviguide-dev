import { startCamera, stopCamera } from "./camera.js";
import { decide, markApproaching, resetNavigation } from "./navigation.js";
import { unlockSpeech, say, setOnSpeak, cancelSpeech } from "./speech.js";
import { handleAlert, resetAlerts, setHold } from "./alerts.js";
import { buildSceneJson } from "./scene.js";
import { setOverlay, startDisplay, stopDisplay } from "./overlay.js";
import { updateGeometry } from "./geometry.js";
import { startIntro } from "./intro.js";
import { createVoice } from "./voice.js";
import { loadAnswerModel, isReady, interpretQuestion } from "./embed.js";
import { respond } from "./answers.js";

// Spoken as a safety message while the phone is held sideways.
const UPRIGHT_MSG = "Hold your phone upright.";

const video = document.getElementById("camera");
const button = document.getElementById("toggle");
const status = document.getElementById("status");

// Keeps the screen on while the app is open, so the phone doesn't pause the mic.
let wakeLock = null;

async function keepAwake() {
	try {
		if (!("wakeLock" in navigator) || wakeLock) return;
		wakeLock = await navigator.wakeLock.request("screen");
		wakeLock.addEventListener("release", () => (wakeLock = null));
	} catch (err) {
		console.warn("wake lock failed:", err);
	}
}

// The browser releases the wake lock when the page is hidden, so get it back when the page is shown again.
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") keepAwake();
});

let running = false;
let loopId = 0;
let busy = false;
let needReset = false; // Tells the worker to start its ground state fresh.
let lastGround = null;
let lastSemMap = null;
let lastDets = [];
let lastAlertText = "";
let prevMeters = new Map();
let stopRequested = false; // Set when "stop navigation" is said while the app is still loading.
// The model worker and the request in flight, if any.
let worker = null;
let pending = null;
let modelsReady = false;
let backend = "none";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describe(dets) {
	if (dets.length === 0) return "Nothing detected.";
	return (
		dets
			.slice(0, 5)
			.map((d) => {
				const name = d.kind === "moving" ? d.label : "obstacle";
				return `${name} ${d.zone} ${d.meters.toFixed(1)}m (${d.score.toFixed(2)})`;
			})
			.join(", ") + "."
	);
}

const fmt = (v) => (v == null ? "none" : v.toFixed(1));

// What the user needs to know about the ground: what they're standing on,
// what is ahead, and which bottom zones are walkable.
function describeGround(s) {
	const z = s.bottomWalkZones;
	const ahead =
		s.aheadM == null
			? (s.aheadSurface ?? "none")
			: `${s.aheadSurface} ${fmt(s.aheadM)}m`;
	return (
		`Under you: ${s.standingSurface ?? "unknown"}. Ahead: ${ahead}. ` +
		`Walk zones L${z.left} C${z.center} R${z.right}.`
	);
}

// True when a phone or tablet is held sideways. Laptops and desktops are skipped,
// since they are always horizontal. Uses the screen orientation, and falls back
// to the window shape if the browser doesn't report an orientation.
function isHorizontal() {
	if (!(navigator.maxTouchPoints > 0)) return false;
	const type = screen.orientation?.type;
	if (type) return type.startsWith("landscape");
	return window.innerWidth > window.innerHeight;
}

// Gets the model worker, starting it the first time.
function getWorker() {
	if (!worker) {
		worker = new Worker("./js/worker.js");
		worker.onmessage = (e) => {
			if (!pending) return;
			const { resolve, reject } = pending;
			pending = null;
			if (e.data.type === "error") reject(new Error(e.data.message));
			else resolve(e.data);
		};
		worker.onerror = (e) => {
			if (!pending) return;
			const { reject } = pending;
			pending = null;
			reject(new Error(e.message || "The model worker failed."));
		};
	}
	return worker;
}

// Sends one request to the worker and waits for its reply.
function request(msg, transfer = []) {
	return new Promise((resolve, reject) => {
		pending = { resolve, reject };
		getWorker().postMessage(msg, transfer);
	});
}

// Loads the models inside the worker. Only runs once per page load.
async function loadModelsInWorker() {
	if (modelsReady) return;
	const base = new URL("./", document.baseURI).href;
	const reply = await request({ type: "init", base });
	backend = reply.backend;
	modelsReady = true;
}

// Sends one camera frame to the worker, then updates the app with the result.
async function inferOnce() {
	busy = true;
	try {
		const vw = video.videoWidth;
		const vh = video.videoHeight;
		updateGeometry(vw, vh);
		const bitmap = await createImageBitmap(video);
		const reset = needReset;
		needReset = false;

		const r = await request({ type: "frame", bitmap, reset, vw, vh }, [bitmap]);

		// Stop was pressed while the worker was busy. Don't update anything.
		if (!running) return;

		if (r.sem) lastSemMap = { dims: r.sem.dims, data: r.sem.data };
		lastGround = r.ground;

		const dets = r.dets;
		prevMeters = markApproaching(dets, prevMeters);

		let alert = decide(dets, lastGround, r.fresh);
		if (isHorizontal()) {
			// A safety message: it repeats every REMINDER_MS until the phone is upright again.
			alert = {
				...alert,
				key: "orientation",
				text: UPRIGHT_MSG,
				tier: 1,
				topic: null,
				safety: true,
				reminder: UPRIGHT_MSG,
			};
		}
		handleAlert(alert);
		lastDets = dets;
		lastAlertText = alert.text;
		setOverlay(lastSemMap, alert.focus);

		console.log("timing", backend, r.timing);

		status.textContent = `Alert: "${alert.text}" | ${describe(dets)} | ${describeGround(lastGround)}`;
	} catch (err) {
		status.textContent = `Inference error: ${err.message}`;
	} finally {
		busy = false;
	}
}

// Runs analysis back to back. Each pass starts as soon as the previous one ends.
// The id check stops an old loop if Stop and Start are pressed quickly.
async function loop(id) {
	while (running && id === loopId) {
		if (video.readyState < 2 || busy) {
			await sleep(100);
			continue;
		}
		await inferOnce();
		await sleep(0);
	}
}

async function startApp() {
	if (running || button.disabled) return;
	stopRequested = false;
	button.disabled = true;
	try {
		unlockSpeech();
		resetAlerts();
		resetNavigation();
		prevMeters = new Map();
		lastGround = null;
		lastSemMap = null;
		needReset = true;
		status.textContent = "Starting camera…";
		await startCamera(video);
		startDisplay(video);
		status.textContent = "Loading models…";
		await loadModelsInWorker();
		running = true;
		loopId++;
		button.textContent = "Stop";
		if (stopRequested) {
			stopApp();
			return;
		}
		say("Navigation started.");
		loop(loopId);
		// Load the answer model after navigation is running, so it doesn't compete with voice and the camera models.
		setTimeout(() => {
			loadAnswerModel((text) => console.log("model:", text)).catch((err) =>
				console.warn("answer model failed to load:", err),
			);
		}, 3000);
	} catch (err) {
		status.textContent = `Error: ${err.name}. ${err.message}`;
	} finally {
		button.disabled = false;
	}
}

function stopApp() {
	if (!running) {
		stopRequested = true; // Stop was said while still loading.
		return;
	}
	running = false;
	loopId++;
	stopCamera(video);
	stopDisplay();
	button.textContent = "Start";
	status.textContent = "Camera off.";
	cancelSpeech(); // Stop any navigation alert still being spoken.
	// Give the browser a moment to clear the cancelled alert before speaking again.
	setTimeout(() => say("Navigation stopped."), 400);
}

// Answers from the scene at the moment the question was asked.
// Code answers the known question types. The model only labels questions it doesn't recognize.
async function answerQuestion(question) {
	try {
		const scene = buildSceneJson(lastDets, lastGround, lastAlertText);
		console.log("question:", question);
		let reply;
		if (!scene) {
			reply = "I don't have a camera reading yet.";
		} else {
			reply = await respond(
				scene,
				question,
				isReady() ? interpretQuestion : null,
			);
		}
		console.log("answer:", reply);
		say(reply);
		setTimeout(() => setHold(false), 1000 + reply.length * 80);
	} catch (err) {
		console.warn("answer failed:", err);
		say("Sorry, I couldn't answer that.");
		setTimeout(() => setHold(false), 2000);
	}
}

const voice = createVoice({
	onStart: startApp,
	onStop: stopApp,
	onStatus: (text) => (status.textContent = text),
	onQuestionOpen: () => {
		setHold(true);
		say("Yes?");
	},
	onRetry: () => {
		say("Sorry, I didn't get that. Try again.");
	},
	onQuestionTimeout: () => {
		say("Sorry, I still didn't get that.");
		setTimeout(() => setHold(false), 2000);
	},
	onQuestion: answerQuestion,
	isRunning: () => running,
});

// Every spoken line is recorded, so the mic's echo of it can be dropped.
setOnSpeak((text) => voice.noteSpeech(text));

button.addEventListener("click", () => (running ? stopApp() : startApp()));

// The first tap (on the intro screen) starts voice listening.
document.addEventListener("pointerdown", () => voice.listen(), { once: true });

// The answer model loads in the background after the intro, so it doesn't delay startup.
startIntro(() => {
	voice.resume();
});
