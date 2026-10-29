// Builds the scene snapshot for a question. Only the latest reading is used.
const round1 = (v) => Math.round(v * 10) / 10;

export function buildSceneJson(dets, ground, alertText) {
	if (!ground) return null;
	return {
		objects: dets.map((d) => ({
			label: d.kind === "moving" ? d.label : "obstacle",
			zone: d.zone,
			distance_m: round1(d.meters),
			approaching: !!d.stableApproach,
		})),
		ground: {
			under_user: ground.standingSurface,
			ahead: ground.aheadSurface,
			ahead_distance_m: ground.aheadM == null ? null : round1(ground.aheadM),
			walkable_percent: ground.bottomWalkZones,
		},
		doors: Object.fromEntries(
			["left", "center", "right"].map((z) => {
				const m = ground.doorZones?.[z]?.m;
				return [z, m == null ? null : round1(m)];
			}),
		),
		stairs_distance_m: ground.hazardM == null ? null : round1(ground.hazardM),
		wall_or_building: ground.structName
			? {
					name: ground.structName,
					distance_m: ground.wallM == null ? null : round1(ground.wallM),
				}
			: null,
		current_alert: alertText,
	};
}
