import {
	WALKABLE_IDS,
	WARNING_IDS,
	HAZARD_IDS,
	DOOR_IDS,
	STRUCTURE_IDS,
	STRUCTURE_NAMES,
	SURFACE_NAMES,
	STAND_TOP,
	AHEAD_TOP,
	WALL_TOP,
	SURFACE_MIN_PCT,
} from "./config.js";
import { MODEL, geometry, zoneOfX } from "./geometry.js";

const BIN_M = 0.1; // depth histogram resolution, in meters
const MAX_M = 20; // anything farther goes in the last bin
const BINS = Math.round(MAX_M / BIN_M);
const WARN_KEY = { left: "warnLeft", center: "warnCenter", right: "warnRight" };

const isGround = (id) => WALKABLE_IDS.has(id) || WARNING_IDS.has(id);

function newHist() {
	return new Uint32Array(BINS + 1);
}

function getHist(map, id) {
	if (!map.has(id)) map.set(id, newHist());
	return map.get(id);
}

function addDepth(h, m) {
	if (!(m >= 0)) return false;
	h[Math.min(BINS, Math.round(m / BIN_M))]++;
	return true;
}

// Nearest distance: the 10th percentile, so one noisy pixel doesn't decide it.
function nearest(h, count) {
	if (!h || count === 0) return null;
	const target = count * 0.1;
	let acc = 0;
	for (let b = 0; b <= BINS; b++) {
		acc += h[b];
		if (acc >= target) return b * BIN_M;
	}
	return null;
}

// The most common ground class in a band, if it covers enough of the band.
function dominant(counts, bandTotal) {
	let best = null;
	let bestN = 0;
	for (const [id, n] of counts) {
		if (n > bestN) {
			best = id;
			bestN = n;
		}
	}
	if (best === null || bandTotal === 0) return null;
	return Math.round((100 * bestN) / bandTotal) >= SURFACE_MIN_PCT ? best : null;
}

// Reads the [1, 640, 640] class-ID map and the matching depth map.
// Only pixels of the real picture are counted, so the gray padding is ignored.
export function analyzeSem(t, depthMap) {
	const g = geometry();
	const d = t.data;
	const depth = depthMap ? depthMap.data : null;
	const xEnd = g.x0 + g.cw;
	const yEnd = g.y0 + g.ch;

	const bottomStart = g.y0 + Math.round((2 * g.ch) / 3);
	const standStart = g.y0 + Math.round(STAND_TOP * g.ch);
	const aheadStart = g.y0 + Math.round(AHEAD_TOP * g.ch);
	const wallStart = g.y0 + Math.round(WALL_TOP * g.ch);

	const total = g.cw * g.ch;
	const bottomTotal = Math.max(0, (yEnd - bottomStart) * g.cw);
	const standTotal = Math.max(0, (yEnd - standStart) * g.cw);
	const aheadTotal = Math.max(0, (standStart - aheadStart) * g.cw);

	const counts = new Map();
	let walk = 0,
		hazard = 0,
		door = 0,
		structRegion = 0,
		structure = 0;
	const bottom = {
		left: 0,
		center: 0,
		right: 0,
		walk: 0,
		warn: 0,
		warnLeft: 0,
		warnCenter: 0,
		warnRight: 0,
	};

	const hHazard = newHist(),
		hDoor = newHist(),
		hStruct = newHist();
	let nHazard = 0,
		nDoor = 0,
		nStruct = 0;

	const doorZ = { left: 0, center: 0, right: 0 };
	const nDoorZ = { left: 0, center: 0, right: 0 };
	const hDoorZ = { left: newHist(), center: newHist(), right: newHist() };
	const hazardZ = { left: 0, center: 0, right: 0 };
	const nHazardZ = { left: 0, center: 0, right: 0 };
	const hHazardZ = { left: newHist(), center: newHist(), right: newHist() };

	const structCounts = new Map();
	const standCounts = new Map();
	const aheadCounts = new Map();
	const aheadHist = new Map();
	const aheadN = new Map();

	for (let row = g.y0; row < yEnd; row++) {
		const base = row * MODEL;
		const inBottom = row >= bottomStart;
		const inStand = row >= standStart;
		const inAhead = !inStand && row >= aheadStart;
		const inStructRows = row >= wallStart;

		for (let col = g.x0; col < xEnd; col++) {
			const i = base + col;
			const id = Math.round(d[i]);
			counts.set(id, (counts.get(id) || 0) + 1);
			const m = depth ? depth[i] : NaN;
			const zone = zoneOfX(col);

			if (WALKABLE_IDS.has(id)) {
				walk++;
			} else if (HAZARD_IDS.has(id)) {
				hazard++;
				hazardZ[zone]++;
				if (addDepth(hHazard, m)) nHazard++;
				if (addDepth(hHazardZ[zone], m)) nHazardZ[zone]++;
			} else if (DOOR_IDS.has(id)) {
				door++;
				doorZ[zone]++;
				if (addDepth(hDoor, m)) nDoor++;
				if (addDepth(hDoorZ[zone], m)) nDoorZ[zone]++;
			}

			// Structure (wall or building): the center path, from the middle of the picture down.
			if (inStructRows && zone === "center") {
				structRegion++;
				if (STRUCTURE_IDS.has(id)) {
					structure++;
					structCounts.set(id, (structCounts.get(id) || 0) + 1);
					if (addDepth(hStruct, m)) nStruct++;
				}
			}

			// Side zones over the bottom third, used to pick a direction to step.
			if (inBottom) {
				if (WALKABLE_IDS.has(id)) {
					bottom.walk++;
					bottom[zone]++;
				} else if (WARNING_IDS.has(id)) {
					bottom.warn++;
					bottom[WARN_KEY[zone]]++;
				}
			}

			// Surface under the user (bottom band) and surface ahead (band above it).
			if (isGround(id)) {
				if (inStand) {
					standCounts.set(id, (standCounts.get(id) || 0) + 1);
				} else if (inAhead) {
					aheadCounts.set(id, (aheadCounts.get(id) || 0) + 1);
					if (depth && addDepth(getHist(aheadHist, id), m)) {
						aheadN.set(id, (aheadN.get(id) || 0) + 1);
					}
				}
			}
		}
	}

	const pct = (n, of) => (of > 0 ? Math.round((100 * n) / of) : 0);
	const topIds = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([id, n]) => `${id}:${pct(n, total)}%`)
		.join(" ");

	// Whichever structure class covers more of the center path is the one named.
	let structName = null;
	let bestStruct = 0;
	for (const [id, n] of structCounts) {
		if (n > bestStruct) {
			bestStruct = n;
			structName = STRUCTURE_NAMES[id];
		}
	}

	const standId = dominant(standCounts, standTotal);
	const aheadId = dominant(aheadCounts, aheadTotal);
	const aheadNum = aheadId !== null ? aheadN.get(aheadId) || 0 : 0;

	const doorZones = {};
	for (const z of ["left", "center", "right"]) {
		doorZones[z] = {
			pct: pct(doorZ[z], total),
			m: nearest(hDoorZ[z], nDoorZ[z]),
		};
	}

	const hazardZones = {};
	for (const z of ["left", "center", "right"]) {
		hazardZones[z] = {
			pct: pct(hazardZ[z], total),
			m: nearest(hHazardZ[z], nHazardZ[z]),
		};
	}

	return {
		hazardPct: pct(hazard, total),
		doorPct: pct(door, total),
		wallPct: pct(structure, structRegion),
		hazardM: nearest(hHazard, nHazard),
		doorM: nearest(hDoor, nDoor),
		wallM: nearest(hStruct, nStruct),
		structName,
		doorZones,
		hazardZones,
		bottomWalkZones: {
			left: pct(bottom.left, bottomTotal),
			center: pct(bottom.center, bottomTotal),
			right: pct(bottom.right, bottomTotal),
		},
		bottomWarnZones: {
			left: pct(bottom.warnLeft, bottomTotal),
			center: pct(bottom.warnCenter, bottomTotal),
			right: pct(bottom.warnRight, bottomTotal),
		},
		standingSurface: standId !== null ? SURFACE_NAMES[standId] : null,
		aheadSurface: aheadId !== null ? SURFACE_NAMES[aheadId] : null,
		aheadM: aheadNum > 0 ? nearest(aheadHist.get(aheadId), aheadNum) : null,
		topIds,
	};
}
