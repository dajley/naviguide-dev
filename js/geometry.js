// Maps the camera picture onto the 640x640 square the models use (letterboxed, with gray
// padding), and splits the real picture into left, center, and right zones.
// Used by the model code, the ground reader, the detector, and the overlay.

// Size of the square the models see.
export const MODEL = 640;

// The model sees a 640x640 square. The camera frame is letterboxed into it: scaled to fit,
// centered, and padded with gray. These values describe where the real picture sits.
const g = { x0: 0, y0: 0, cw: MODEL, ch: MODEL, vw: MODEL, vh: MODEL };

// Called once per frame with the camera frame's size. Recalculates only when the size changes.
export function updateGeometry(vw, vh) {
	if (!vw || !vh) return;
	if (g.vw === vw && g.vh === vh) return;
	const scale = Math.min(MODEL / vw, MODEL / vh);
	g.cw = Math.round(vw * scale);
	g.ch = Math.round(vh * scale);
	g.x0 = Math.round((MODEL - g.cw) / 2);
	g.y0 = Math.round((MODEL - g.ch) / 2);
	g.vw = vw;
	g.vh = vh;
}

export function geometry() {
	return g;
}

// Left, center, or right third of the real picture. x is in model coordinates.
export function zoneOfX(x) {
	const third = g.cw / 3;
	if (x < g.x0 + third) return "left";
	if (x < g.x0 + 2 * third) return "center";
	return "right";
}

// Horizontal extent of each zone of the real picture, in model coordinates.
export function zoneRanges() {
	const third = g.cw / 3;
	return {
		left: [g.x0, g.x0 + third],
		center: [g.x0 + third, g.x0 + 2 * third],
		right: [g.x0 + 2 * third, g.x0 + g.cw],
	};
}
