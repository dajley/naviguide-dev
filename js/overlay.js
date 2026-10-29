import {
	WALKABLE_IDS,
	WARNING_IDS,
	HAZARD_IDS,
	DOOR_IDS,
	STRUCTURE_IDS,
} from "./config.js";
import { MODEL, geometry } from "./geometry.js";

const CAT_WALK = 1;
const CAT_WARN = 2;
const CAT_HAZARD = 3;
const CAT_DOOR = 4;
const CAT_STRUCT = 5;
const CAT_BY_NAME = {
	walk: CAT_WALK,
	warn: CAT_WARN,
	hazard: CAT_HAZARD,
	door: CAT_DOOR,
	structure: CAT_STRUCT,
};

// How quickly the highlight box catches up to a new detection, as a fraction of the remaining
// distance per screen frame. Higher follows more closely, lower is smoother.
const EASE = 0.3;
// If no new analysis arrives for FADE_START_MS, the overlay starts to fade and fades out over FADE_MS.
const FADE_START_MS = 1000;
const FADE_MS = 500;

// Category lookup from class ID. 0 means the class isn't drawn.
const CAT_OF = new Uint8Array(256);
for (const id of WALKABLE_IDS) CAT_OF[id] = CAT_WALK;
for (const id of WARNING_IDS) CAT_OF[id] = CAT_WARN;
for (const id of HAZARD_IDS) CAT_OF[id] = CAT_HAZARD;
for (const id of DOOR_IDS) CAT_OF[id] = CAT_DOOR;
for (const id of STRUCTURE_IDS) CAT_OF[id] = CAT_STRUCT;

// Colors as [r, g, b, alpha]. Walkable surfaces are a pale green, warning surfaces a deeper
// green, doors red, stairs dark red, and structures a blue fill.
const STYLE = {
	[CAT_WALK]: [120, 220, 120, 120],
	[CAT_WARN]: [0, 110, 40, 170],
	[CAT_HAZARD]: [150, 0, 0, 170],
	[CAT_DOOR]: [255, 60, 60, 160],
	[CAT_STRUCT]: [30, 120, 255, 130],
};
const OBJECT_RGB = { moving: [255, 140, 0], general: [170, 80, 255] };

// The overlay canvas sits on top of the live camera video. The browser draws the video itself,
// so the picture stays smooth. This canvas holds only the ground colors and the highlight box.
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// Ground layer: the 640×640 class map, colored, drawn only for the categories in focus.
const groundCanvas = document.createElement("canvas");
groundCanvas.width = MODEL;
groundCanvas.height = MODEL;
const groundCtx = groundCanvas.getContext("2d");
const groundImage = groundCtx.createImageData(MODEL, MODEL);
const catMap = new Uint8Array(MODEL * MODEL);

let video = null;
let running = false;
let frameId = 0;
let passTime = 0; // when the latest analysis pass finished
let groundReady = false;
let lastTensor = null;
let lastActiveKey = "";

// The highlight. lead is the object from the latest pass. targetBox is where that pass put it.
// shownBox is where the box is drawn now, and it eases toward targetBox every screen frame.
let lead = null;
let leadKey = null;
let targetBox = null;
let shownBox = null;

function resetLead() {
	lead = null;
	leadKey = null;
	targetBox = null;
	shownBox = null;
}

// Colors the class map. Walkable surfaces are always shown. Other categories are shown only
// when they're in the active set.
function drawGround(classTensor, active) {
	const src = classTensor.data;
	const n = MODEL * MODEL;
	for (let i = 0; i < n; i++) {
		const id = Math.round(src[i]);
		catMap[i] = id >= 0 && id < 256 ? CAT_OF[id] : 0;
	}

	const px = groundImage.data;
	for (let i = 0; i < n; i++) {
		const cat = catMap[i];
		const o = i * 4;
		px[o + 3] = 0;
		if (!cat) continue;
		if (cat !== CAT_WALK && !active.has(cat)) continue;

		const s = STYLE[cat];
		px[o] = s[0];
		px[o + 1] = s[1];
		px[o + 2] = s[2];
		px[o + 3] = s[3];
	}
	groundCtx.putImageData(groundImage, 0, 0);
}

// Highlights the object with a translucent fill, a soft white outline, and a small label.
// box is in model coordinates. It's mapped to the camera picture (w x h).
function drawLead(obj, box, g, w, h) {
	const sx = w / g.cw;
	const sy = h / g.ch;
	const [x1, y1, x2, y2] = box;
	const x = (x1 - g.x0) * sx;
	const y = (y1 - g.y0) * sy;
	const bw = (x2 - x1) * sx;
	const bh = (y2 - y1) * sy;
	const [r, gg, b] = obj.moving ? OBJECT_RGB.moving : OBJECT_RGB.general;
	const lw = Math.max(4, Math.round(h * 0.008));

	ctx.save();
	ctx.fillStyle = `rgba(${r}, ${gg}, ${b}, 0.28)`;
	ctx.fillRect(x, y, bw, bh);
	ctx.strokeStyle = "#ffffff";
	ctx.lineWidth = lw;
	ctx.strokeRect(x, y, bw, bh);
	ctx.restore();

	const fs = Math.max(12, Math.round(h * 0.03));
	const text = `${obj.name} ${obj.meters.toFixed(1)}m`;
	ctx.font = `600 ${fs}px system-ui, sans-serif`;
	ctx.textBaseline = "top";
	const pad = 4;
	const tw = ctx.measureText(text).width + pad * 2;
	const top = Math.max(0, y - fs - pad * 2);
	ctx.fillStyle = `rgb(${r}, ${gg}, ${b})`;
	ctx.fillRect(x, top, tw, fs + pad * 2);
	ctx.fillStyle = "#000";
	ctx.fillText(text, x + pad, top + pad);
}

// Draws one screen frame of the overlay. The camera picture underneath is the live video.
function drawOverlay(now) {
	const w = video?.videoWidth || video?.naturalWidth || 0;
	const h = video?.videoHeight || video?.naturalHeight || 0;
	if (!w || !h) return;
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	ctx.clearRect(0, 0, w, h);

	// Ease the box toward the latest detection, so it glides instead of jumping.
	if (shownBox && targetBox) {
		shownBox = shownBox.map((v, i) => v + (targetBox[i] - v) * EASE);
	}

	// Fade the overlay out if the analysis has stopped giving new results.
	const age = now - passTime;
	const alpha =
		age <= FADE_START_MS ? 1 : Math.max(0, 1 - (age - FADE_START_MS) / FADE_MS);
	if (alpha <= 0) return;

	ctx.globalAlpha = alpha;
	const g = geometry();
	if (groundReady) {
		ctx.drawImage(groundCanvas, g.x0, g.y0, g.cw, g.ch, 0, 0, w, h);
	}
	if (lead && shownBox) drawLead(lead, shownBox, g, w, h);
	ctx.globalAlpha = 1;
}

// Redraws the overlay on every screen frame until stopDisplay() is called.
function frame(now) {
	if (!running) return;
	drawOverlay(now);
	frameId = requestAnimationFrame(frame);
}

// Starts the overlay. Call once the camera is running.
export function startDisplay(videoEl) {
	video = videoEl;
	running = true;
	passTime = 0;
	cancelAnimationFrame(frameId);
	frameId = requestAnimationFrame(frame);
}

// Stops the overlay and clears it.
export function stopDisplay() {
	running = false;
	cancelAnimationFrame(frameId);
	video = null;
	groundReady = false;
	lastTensor = null;
	lastActiveKey = "";
	passTime = 0;
	resetLead();
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Sets the overlay from the latest analysis pass. Called once per pass, not per screen frame.
// classTensor: the most recent class map (may be a few passes old), or null before the first.
// focus: what the current alert is about, from navigation.js, or null.
export function setOverlay(classTensor, focus) {
	passTime = performance.now();

	const active = new Set(
		(focus?.cats ?? []).map((name) => CAT_BY_NAME[name]).filter(Boolean),
	);
	const activeKey = [...active].sort().join(",");

	if (!classTensor) {
		groundReady = false;
		lastTensor = null;
	} else if (classTensor !== lastTensor || activeKey !== lastActiveKey) {
		drawGround(classTensor, active);
		groundReady = true;
		lastTensor = classTensor;
		lastActiveKey = activeKey;
	}

	const obj = focus?.object ?? null;
	if (!obj) {
		resetLead();
		return;
	}
	lead = obj;
	const key = `${obj.name}:${obj.moving ? "m" : "g"}`;
	// A different object starts at its new place, so the box doesn't slide across the screen.
	if (key !== leadKey || !shownBox) {
		shownBox = [...obj.box];
		leadKey = key;
	}
	targetBox = [...obj.box];
}
