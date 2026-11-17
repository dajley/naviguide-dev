// Decides what to say each cycle, from the detections and the ground readings: the nearest
// blocking object, stairs, doors, walls and buildings, surface changes, and a direction
// (keep straight, move left or right, or stop). Uses the thresholds in config.js.
import { zoneRanges } from "./geometry.js";
import {
	CLOSE_M,
	NEAR_M,
	APPROACH_M,
	OPEN_PCT,
	NARROW_PCT,
	HAZARD_PCT,
	DOOR_PCT,
	WALL_PCT,
	STAIRS_M,
	DOOR_M,
	SURFACE_M,
	WALL_PATH_M,
	WALL_NEAR_M,
	SURFACE_CONFIRM,
	WALKABLE_NAMES,
} from "./config.js";

// Stability settings, in analysis cycles. Raise to steady alerts, lower to react faster.
const APPROACH_CONFIRM = 2; // "approaching" must show this many readings in a row
const LEAD_HOLD = 2; // keep the current lead this many cycles after it disappears
const ACTION_CONFIRM = 2; // a new direction must hold this many cycles before it's spoken
const SECOND_CONFIRM = 2; // a second object must hold this many cycles before it's named

const OPPOSITE = { left: "right", right: "left" };

// Ground state. Only updated when the semantic model gives a fresh reading.
let currentSurface = null;
let candidateSurface = null;
let candidateCount = 0;
let aheadConfirmed = null;
let lastAheadName = null;
let pendingStep = null;
let structHist = [];
let prevStructSmooth = null;
let structName = "wall";
let structInfo = { smooth: null, approaching: false, name: "wall" };

// Obstacle state, carried across cycles.
let approachStreak = new Map();
let lead = null;
let stopActive = false;
let secondSeen = new Map();
let actionShown = null;
let actionCandidate = null;
let actionCount = 0;
let wasObstacle = false;
let announcedClear = false;

// The lead object chosen in the most recent obstacle alert, used for the on-screen highlight.
let lastLead = null;

export function resetNavigation() {
	currentSurface = null;
	candidateSurface = null;
	candidateCount = 0;
	aheadConfirmed = null;
	lastAheadName = null;
	pendingStep = null;
	structHist = [];
	prevStructSmooth = null;
	structName = "wall";
	structInfo = { smooth: null, approaching: false, name: "wall" };
	approachStreak = new Map();
	clearObstacleState();
	wasObstacle = false;
	announcedClear = false;
	lastLead = null;
}

// Called by alerts.js once the "You are now on X" message has actually been spoken.
export function confirmSpoken(key) {
	if (pendingStep && key === `on:${pendingStep}`) pendingStep = null;
	// "Path clear" counts as done only once it has actually been spoken.
	if (key === "clear:path") wasObstacle = false;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const where = (zone) => (zone === "center" ? "ahead" : `on your ${zone}`);

// Spoken distance, rounded to the nearest half meter.
export function spokenDistance(m) {
	const half = Math.max(0.5, Math.round(m * 2) / 2);
	return half === 1 ? "1 meter" : `${half} meters`;
}

// Marks moving objects that got closer since the last cycle, matched by label and zone.
export function markApproaching(dets, prev) {
	const next = new Map();
	for (const d of dets) {
		const key = `${d.label}:${d.zone}`;
		const before = prev.get(key);
		d.approaching = before !== undefined && before - d.meters >= APPROACH_M;
		next.set(key, d.meters);
	}
	return next;
}

// Updates the ground state from a fresh semantic reading.
function updateGround(ground) {
	// Surface under the user. A change normally has to hold for SURFACE_CONFIRM readings.
	// If it's the surface we just warned about as approaching, one reading is enough.
	const seen = ground.standingSurface;
	if (seen && seen !== currentSurface) {
		const needed = seen === lastAheadName ? 1 : SURFACE_CONFIRM;
		if (seen === candidateSurface) {
			candidateCount++;
		} else {
			candidateSurface = seen;
			candidateCount = 1;
		}
		if (candidateCount >= needed) {
			if (currentSurface !== null) pendingStep = seen;
			currentSurface = seen;
			candidateSurface = null;
			candidateCount = 0;
		}
	} else {
		candidateSurface = null;
		candidateCount = 0;
	}

	// Surface ahead: no confirmation, since this is only a heads-up.
	const ahead = ground.aheadSurface;
	const inRange = ground.aheadM == null || ground.aheadM <= SURFACE_M;
	aheadConfirmed =
		currentSurface !== null &&
		ahead !== null &&
		ahead !== currentSurface &&
		inRange
			? { name: ahead, m: ground.aheadM ?? null }
			: null;
	if (aheadConfirmed) lastAheadName = aheadConfirmed.name;

	// Structure (wall or building) in the center path: median of the last 3 readings.
	if (ground.structName) structName = ground.structName;
	const m = ground.wallPct >= WALL_PCT ? ground.wallM : null;
	structHist.push(m);
	if (structHist.length > 3) structHist.shift();
	const vals = structHist.filter((v) => v != null).sort((a, b) => a - b);
	const smooth = vals.length ? vals[Math.floor(vals.length / 2)] : null;
	structInfo = {
		smooth,
		name: structName,
		approaching:
			smooth != null &&
			prevStructSmooth != null &&
			prevStructSmooth - smooth >= APPROACH_M,
	};
	prevStructSmooth = smooth;
}

// Approach must show for APPROACH_CONFIRM readings in a row before it counts.
function updateApproach(dets) {
	const seen = new Set();
	for (const d of dets) {
		if (d.kind !== "moving") continue;
		const key = `${d.label}:${d.zone}`;
		seen.add(key);
		const n = d.approaching ? (approachStreak.get(key) || 0) + 1 : 0;
		approachStreak.set(key, n);
		d.stableApproach = n >= APPROACH_CONFIRM;
	}
	for (const k of [...approachStreak.keys()]) {
		if (!seen.has(k)) approachStreak.delete(k);
	}
}

// Which of the three zones a box overlaps horizontally, using the thirds of the real picture.
function zonesOverlapped(box) {
	const [x1, , x2] = box;
	return Object.entries(zoneRanges())
		.filter(([, [a, b]]) => x2 > a && x1 < b)
		.map(([zone]) => zone);
}

// Everything that could be announced, ranked by priority. Lower rank wins.
//   0  moving object approaching, under NEAR_M               (blocks)
//   1  moving object under NEAR_M, not approaching           (blocks)
//   2  general obstacle under CLOSE_M                        (blocks)
//   3  wall or building in the center, under CLOSE_M         (blocks)
//   4  general obstacle in the center, CLOSE_M to NEAR_M     (announced only)
//   5  general obstacle at the side, CLOSE_M to NEAR_M       (announced only)
//   6  wall or building heads-up, CLOSE_M to NEAR_M          (announced only)
function collectCandidates(dets, struct) {
	const list = [];
	for (const d of dets) {
		if (d.kind === "moving") {
			if (d.meters >= NEAR_M) continue;
			list.push({
				id: `${d.label}:${d.zone}`,
				name: d.label,
				rank: d.stableApproach ? 0 : 1,
				meters: d.meters,
				zone: d.zone,
				zones: zonesOverlapped(d.box),
				approaching: !!d.stableApproach,
				blocks: true,
				structure: false,
				moving: true,
				box: d.box,
			});
		} else if (d.meters < NEAR_M) {
			const close = d.meters < CLOSE_M;
			list.push({
				id: `obstacle:${d.zone}:${close ? "c" : "n"}`,
				name: "obstacle",
				rank: close ? 2 : d.zone === "center" ? 4 : 5,
				meters: d.meters,
				zone: d.zone,
				zones: zonesOverlapped(d.box),
				approaching: false,
				blocks: close,
				structure: false,
				moving: false,
				box: d.box,
			});
		}
	}

	const sm = struct.smooth;
	if (sm != null) {
		const base = {
			id: `structure:${struct.name}`,
			name: struct.name,
			meters: sm,
			zone: "center",
			zones: ["center"],
			approaching: struct.approaching,
			structure: true,
			moving: false,
			box: null,
		};
		if (sm < WALL_PATH_M) {
			list.push({ ...base, rank: 3, blocks: true });
		} else if (struct.approaching && sm <= WALL_NEAR_M) {
			list.push({ ...base, rank: 6, blocks: false });
		}
	}

	return list.sort((a, b) => a.rank - b.rank || a.meters - b.meters);
}

// Chooses the lead object. The current lead is kept, so it doesn't bounce between objects.
// A more urgent blocker takes over only if it outranks the current lead.
function pickLead(candidates) {
	const top = candidates[0];
	if (lead) {
		const held = candidates.find((c) => c.id === lead.id);
		if (held) {
			lead.last = held;
			lead.missing = 0;
		} else {
			lead.missing++;
			if (lead.missing > LEAD_HOLD) lead = null;
		}
	}
	if (lead && top.id !== lead.id) {
		const preempt = lead.last.blocks
			? top.blocks && top.rank < lead.last.rank
			: top.blocks;
		if (preempt) lead = null;
	}
	if (!lead) {
		lead = { id: top.id, missing: 0, last: top, wasClose: false };
	}
	return candidates.find((c) => c.id === lead.id) ?? lead.last;
}

// Direction for one zone: blocked by a blocker, open, narrow, or blocked for lack of floor.
function sideStatus(side, blockers, ground) {
	if (blockers.some((b) => b.zones.includes(side))) return "blocked";
	const usable = ground.bottomWalkZones[side] + ground.bottomWarnZones[side];
	if (usable >= OPEN_PCT) return "open";
	if (usable >= NARROW_PCT) return "narrow";
	return "blocked";
}

// The direction, from every blocker at once.
function multiAction(blockers, ground) {
	const status = {
		left: sideStatus("left", blockers, ground),
		center: sideStatus("center", blockers, ground),
		right: sideStatus("right", blockers, ground),
	};
	const usable = (s) => ground.bottomWalkZones[s] + ground.bottomWarnZones[s];

	if (status.center !== "blocked") {
		// An object on one side with an open center: step away from it if the other side is open.
		const sideBlocked = ["left", "right"].find(
			(s) =>
				status[s] === "blocked" && blockers.some((b) => b.zones.includes(s)),
		);
		if (sideBlocked && status[OPPOSITE[sideBlocked]] === "open") {
			return `Move ${OPPOSITE[sideBlocked]}`;
		}
		return status.center === "open" ? "Keep straight" : "Narrow path ahead";
	}

	const options = ["left", "right"]
		.filter((s) => status[s] !== "blocked")
		.sort(
			(a, b) =>
				(status[a] === "open" ? 0 : 1) - (status[b] === "open" ? 0 : 1) ||
				usable(b) - usable(a),
		);

	if (options.length === 0) return "Stop";
	const best = options[0];
	return status[best] === "open"
		? `Move ${best}`
		: `Narrow path on your ${best}`;
}

// Direction is spoken only after it has held for ACTION_CONFIRM cycles.
// Stop is immediate, and leaving a stop is immediate too.
function resetAction() {
	actionShown = null;
	actionCandidate = null;
	actionCount = 0;
}

function stableAction(raw) {
	if (
		raw === "Stop" ||
		actionShown === null ||
		actionShown === "Stop" ||
		raw === actionShown
	) {
		actionShown = raw;
		actionCandidate = null;
		actionCount = 0;
		return raw;
	}
	if (raw === actionCandidate) {
		actionCount++;
	} else {
		actionCandidate = raw;
		actionCount = 1;
	}
	if (actionCount >= ACTION_CONFIRM) {
		actionShown = raw;
		actionCandidate = null;
		actionCount = 0;
	}
	return actionShown;
}

// A second blocker is named only after it has been seen for SECOND_CONFIRM cycles.
function pickSecond(blockers, leadId) {
	const ids = new Set();
	for (const b of blockers) {
		if (b.id === leadId) continue;
		ids.add(b.id);
		secondSeen.set(b.id, (secondSeen.get(b.id) || 0) + 1);
	}
	for (const k of [...secondSeen.keys()]) {
		if (!ids.has(k)) secondSeen.delete(k);
	}
	return (
		blockers.find(
			(b) => b.id !== leadId && (secondSeen.get(b.id) || 0) >= SECOND_CONFIRM,
		) ?? null
	);
}

function clearObstacleState() {
	lead = null;
	stopActive = false;
	secondSeen = new Map();
	resetAction();
}

// Phrase for one object, with its distance.
function phraseOf(c) {
	const dist = spokenDistance(c.meters);
	if (c.structure) return `${cap(c.name)} ahead, ${dist}`;
	if (c.approaching)
		return `${cap(c.name)} approaching, ${where(c.zone)}, ${dist}`;
	return `${cap(c.name)} ${where(c.zone)}, ${dist}`;
}

// Short phrase for reminders, without the distance.
function reminderOf(c) {
	if (c.structure) return `${cap(c.name)} still ahead`;
	return `${cap(c.name)} still ${where(c.zone)}`;
}

// Two objects named together for a stop, like "Person and chair ahead".
function bothPhrase(a, b) {
	if (a.name === b.name) {
		const plural = a.name === "person" ? "people" : `${a.name}s`;
		return `Two ${plural} ${where(a.zone)}`;
	}
	return `${cap(a.name)} and ${b.name} ${where(a.zone)}`;
}

// Builds the obstacle alert for this cycle from the lead object and the direction.
function obstacleAlert(candidates, ground) {
	const L = pickLead(candidates);
	lastLead = L;
	const blockers = candidates.filter((c) => c.blocks);

	// The direction uses every blocker, including the lead even if it's briefly out of view.
	const dirBlockers = L.blocks
		? [L, ...blockers.filter((b) => b.id !== L.id)]
		: [];
	const rawAction = L.blocks ? multiAction(dirBlockers, ground) : null;

	// Stop: an approaching person or moving object in the center path that is close or
	// leaves no clear side, or a wall or building under CLOSE_M with no clear side.
	const wasStop = stopActive;
	const centerLead = L.blocks && L.zones.includes("center");
	const personStop =
		L.rank === 0 &&
		centerLead &&
		(wasStop || L.meters < CLOSE_M || rawAction === "Stop");
	const structStop =
		L.structure && L.blocks && L.meters < CLOSE_M && rawAction === "Stop";
	stopActive = personStop || structStop;
	const stopping = stopActive;
	const newStop = stopping && !wasStop;

	// Newly close: marks the moment the lead first comes within CLOSE_M.
	const isClose = L.blocks && L.meters < CLOSE_M;
	const newlyClose = isClose && !lead.wasClose;
	lead.wasClose = isClose;

	const second = L.blocks ? pickSecond(blockers, L.id) : null;
	if (!L.blocks) secondSeen = new Map();

	let action = null;
	if (L.blocks) {
		action = stopping ? "Stop" : stableAction(rawAction);
		// A wall or building is passed by turning, not by stepping sideways.
		if (L.structure && action && action.startsWith("Move ")) {
			action = action.replace("Move ", "Turn ");
		}
	} else {
		resetAction();
	}

	wasObstacle = true;
	announcedClear = false;

	const useSecond = stopping && !!second;
	let text;
	let reminder;
	if (stopping) {
		const head = useSecond ? bothPhrase(L, second) : phraseOf(L);
		text = useSecond
			? `${head}, ${spokenDistance(L.meters)}. Stop.`
			: `${head}. Stop.`;
		reminder = `${reminderOf(L)}. Stop.`;
	} else if (L.blocks) {
		text = `${phraseOf(L)}. ${action}.`;
		reminder = `${reminderOf(L)}. ${action}.`;
	} else {
		text = `${phraseOf(L)}.`;
		reminder = `${reminderOf(L)}.`;
	}

	// The key changes when the situation changes, so a new message is spoken.
	// While a stop continues, it changes only when the object crosses a whole meter.
	const band = L.meters < CLOSE_M ? "c" : Math.floor(L.meters);
	const approachFlag = L.structure ? 0 : L.approaching ? 1 : 0;
	const key = stopping
		? `stop:${L.id}:${useSecond ? second.id : ""}:${band}`
		: `lead:${L.id}:${L.blocks ? 1 : 0}:${approachFlag}:${action ?? ""}`;

	return {
		key,
		text,
		interrupt: newStop || newlyClose,
		tier: L.blocks ? 1 : 2,
		reminder,
	};
}

// Door alert. A center door comes first. A side door is named with its side.
// Only doors within DOOR_M and above DOOR_PCT count. Both door classes are included.
function doorAlert(ground) {
	const zones = ground.doorZones;
	if (!zones) return null;
	const pick = (zone) => {
		const v = zones[zone];
		return v && v.pct >= DOOR_PCT && v.m != null && v.m <= DOOR_M ? v : null;
	};

	const c = pick("center");
	if (c) {
		return {
			key: "door:center",
			text: `Door ahead, ${spokenDistance(c.m)}.`,
			interrupt: false,
			tier: 3,
			reminder: "Door still ahead.",
		};
	}
	for (const side of ["left", "right"]) {
		const s = pick(side);
		if (s) {
			return {
				key: `door:${side}`,
				text: `Door on your ${side}, ${spokenDistance(s.m)}.`,
				interrupt: false,
				tier: 3,
				reminder: `Door still on your ${side}.`,
			};
		}
	}
	return null;
}

// The alert logic. Returns the spoken message for this cycle.
function decideAlert(dets, ground, fresh) {
	if (fresh) updateGround(ground);
	updateApproach(dets);

	// Tier 1: stairs.
	if (
		ground.hazardPct >= HAZARD_PCT &&
		(ground.hazardM == null || ground.hazardM <= STAIRS_M)
	) {
		return {
			key: "stairs",
			text: `Stairs ahead${ground.hazardM == null ? "" : `, ${spokenDistance(ground.hazardM)}`}.`,
			interrupt: true,
			tier: 1,
			reminder: "Stairs still ahead.",
		};
	}

	// Tiers 1 and 2: people, moving objects, general obstacles, walls, and buildings, as one lead alert.
	const candidates = collectCandidates(dets, structInfo);
	if (candidates.length > 0) {
		announcedClear = false;
		return obstacleAlert(candidates, ground);
	}
	clearObstacleState();

	// Tier 2: an obstacle just ended. "Path clear" stays pending until it's spoken,
	// and outranks doors and surfaces. A new obstacle still replaces it.
	if (wasObstacle) {
		announcedClear = true;
		return {
			key: "clear:path",
			text: "Path clear.",
			interrupt: false,
			tier: 2,
			reminder: null,
		};
	}

	// Tier 3: a surface change you've stepped onto. Stays pending until it's spoken,
	// and is dropped only if you've moved onto a different surface.
	if (pendingStep && pendingStep === currentSurface) {
		return {
			key: `on:${pendingStep}`,
			text: `You are now on ${pendingStep}.`,
			interrupt: false,
			tier: 3,
			reminder: null,
		};
	}

	// Tier 3: doors, then surfaces ahead.
	const door = doorAlert(ground);
	if (door) return door;

	if (aheadConfirmed) {
		const name = aheadConfirmed.name;
		const A = cap(name);
		const dist =
			aheadConfirmed.m == null ? "" : `, ${spokenDistance(aheadConfirmed.m)}`;
		const leaving =
			currentSurface !== null &&
			WALKABLE_NAMES.has(currentSurface) &&
			!WALKABLE_NAMES.has(name);
		const text = leaving
			? `${cap(currentSurface)} ends. ${A} approaching${dist}.`
			: `${A} approaching${dist}.`;
		return {
			key: `ahead:${name}`,
			text,
			interrupt: false,
			tier: 3,
			reminder: `${A} still ahead.`,
		};
	}

	// Tier 2: clear. "Keep straight" once at the start. After that, "Continue path" is shown silently.
	if (!announcedClear) {
		announcedClear = true;
		return {
			key: "clear",
			text: "Keep straight.",
			interrupt: false,
			tier: 2,
			reminder: null,
		};
	}
	// Nothing new to say. Shown on the status line only, never spoken.
	return {
		key: "clear",
		text: "Continue path.",
		silent: true,
		interrupt: false,
		tier: 2,
		reminder: null,
	};
}

// What the screen should highlight for this alert. Walkable surfaces are always tinted by
// the overlay, so they don't appear here. Nothing is highlighted for "Path clear" or "Keep straight".
function focusFor(key) {
	if ((key.startsWith("lead:") || key.startsWith("stop:")) && lastLead) {
		if (lastLead.structure) return { cats: ["structure"] };
		return {
			cats: [],
			object: {
				box: lastLead.box,
				moving: lastLead.moving,
				name: lastLead.name === "obstacle" ? "obstacle" : lastLead.name,
				meters: lastLead.meters,
			},
		};
	}
	if (key === "stairs") return { cats: ["hazard"] };
	if (key.startsWith("door:")) return { cats: ["door"] };
	if (key.startsWith("ahead:")) {
		const name = key.slice("ahead:".length);
		return { cats: [WALKABLE_NAMES.has(name) ? "walk" : "warn"] };
	}
	return null;
}

// Maps an alert key to the subject it's about, so the same subject isn't repeated right away.
function topicFor(key) {
	if (key.startsWith("lead:") || key.startsWith("stop:")) {
		const parts = key.split(":");
		return `${parts[1]}:${parts[2]}`;
	}
	return key;
}

// Returns the single alert for this cycle, highest priority first.
// key: identifies the situation
// text: what to say, or "" for nothing
// interrupt: a new stop, an object that just came within CLOSE_M, or stairs
// tier: 1 safety, 2 direction or heads-up, 3 information
// reminder: shorter text spoken if the same situation continues
// focus: what the screen highlights for this alert, or null
// topic: the subject this alert is about, used to avoid repeats
// safety: true for messages that must not be held back by the repeat check
export function decide(dets, ground, fresh = true) {
	lastLead = null;
	const alert = decideAlert(dets, ground, fresh);
	alert.focus = focusFor(alert.key);
	alert.topic = topicFor(alert.key);
	alert.safety =
		!!alert.interrupt ||
		alert.key.startsWith("on:") ||
		alert.key === "clear:path";
	return alert;
}
