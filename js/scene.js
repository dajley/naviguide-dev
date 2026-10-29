// Builds the scene snapshot for a question. Only the latest reading is used.
// "facts" holds answers worked out here, with a "phrase" for each place the model can copy.
// "detections" holds every detection with its real name, for anything the facts don't cover.
import { DOOR_PCT, HAZARD_PCT } from "./config.js";

const ZONES = ["left", "center", "right"];
const NEAREST_COUNT = 3;
const WHERE = { left: "to your left", center: "ahead", right: "to your right" };

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// The distance and place as a short phrase, so the model can copy it exactly.
function placePhrase(zone, distance) {
	const unit = distance === 1 ? "meter" : "meters";
	return `${distance} ${unit} ${WHERE[zone]}`;
}

export function buildSceneJson(dets, ground, alertText) {
	if (!ground) return null;

	const detections = dets.map((d) => ({
		name: d.label,
		kind: d.kind,
		zone: d.zone,
		distance_m: round1(d.meters),
		score: round2(d.score),
		approaching: !!d.stableApproach,
	}));

	// Objects grouped by their real name, each with where they are, nearest first.
	const objectsByName = {};
	for (const d of detections) {
		if (!objectsByName[d.name]) {
			objectsByName[d.name] = { count: 0, places: [] };
		}
		objectsByName[d.name].count++;
		objectsByName[d.name].places.push({
			zone: d.zone,
			distance_m: d.distance_m,
			phrase: placePhrase(d.zone, d.distance_m),
		});
	}
	for (const entry of Object.values(objectsByName)) {
		entry.places.sort((a, b) => a.distance_m - b.distance_m);
	}

	const nearest = [...detections]
		.sort((a, b) => a.distance_m - b.distance_m)
		.slice(0, NEAREST_COUNT)
		.map(({ name, zone, distance_m }) => ({
			name,
			zone,
			distance_m,
			phrase: `${name}, ${placePhrase(zone, distance_m)}`,
		}));

	// A door or stairs counts in a zone when it covers enough of that zone.
	// Distance is not limited here, so far doors and stairs are still reported.
	const doorPlaces = ZONES.flatMap((zone) => {
		const z = ground.doorZones?.[zone];
		if (!z || z.m == null || z.pct < DOOR_PCT) return [];
		const distance_m = round1(z.m);
		return [{ zone, distance_m, phrase: placePhrase(zone, distance_m) }];
	});

	const stairPlaces = ZONES.flatMap((zone) => {
		const z = ground.hazardZones?.[zone];
		if (!z || z.m == null || z.pct < HAZARD_PCT) return [];
		const distance_m = round1(z.m);
		return [{ zone, distance_m, phrase: placePhrase(zone, distance_m) }];
	});

	return {
		facts: {
			objects_by_name: objectsByName,
			object_total: detections.length,
			nearest_objects: nearest,
			doors: {
				present: doorPlaces.length > 0,
				places: doorPlaces,
			},
			stairs: {
				present: stairPlaces.length > 0,
				places: stairPlaces,
			},
			ground: {
				under_user: ground.standingSurface,
				ahead: ground.aheadSurface,
				ahead_distance_m: ground.aheadM == null ? null : round1(ground.aheadM),
				walkable_percent: ground.bottomWalkZones,
			},
			wall_or_building: ground.structName
				? {
						name: ground.structName,
						distance_m: ground.wallM == null ? null : round1(ground.wallM),
					}
				: null,
			current_alert: alertText,
		},
		detections,
	};
}
