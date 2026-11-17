// Central settings for NaViGuide: which object classes count as moving, the class IDs for
// ground and structures, distance and alert thresholds, and timing. Change values here to tune behavior.

// Classes treated as moving obstacles. Their names are announced.
// Any other class is a general obstacle, announced without a name.
export const MOVING_CLASSES = new Set([
	"person",
	"bicycle",
	"car",
	"motorcycle",
	"airplane",
	"bus",
	"train",
	"truck",
	"boat",
	"bird",
	"cat",
	"dog",
	"horse",
	"sheep",
	"cow",
	"elephant",
	"bear",
	"zebra",
	"giraffe",
]);

// ADE20K class IDs for the semantic model.
export const WALKABLE_IDS = new Set([3, 11, 52, 28]); // floor, sidewalk, path, rug
export const WARNING_IDS = new Set([6, 9, 13, 46]); // road, grass, earth, sand
export const HAZARD_IDS = new Set([53, 59, 121]); // stairs, stairway, step
export const DOOR_IDS = new Set([14, 58]); // door, screen door
export const STRUCTURE_IDS = new Set([0, 1]); // wall, building
export const STRUCTURE_NAMES = { 0: "wall", 1: "building" };

// Spoken names for ground classes, and which ones count as walkable ground.
export const SURFACE_NAMES = {
	3: "floor",
	11: "sidewalk",
	52: "path",
	28: "rug",
	6: "road",
	9: "grass",
	13: "dirt",
	46: "sand",
};
export const WALKABLE_NAMES = new Set(["floor", "sidewalk", "path", "rug"]);

// Ground bands, as fractions of frame height.
export const STAND_TOP = 0.95; // bottom 5%: the surface under the user
export const AHEAD_TOP = 0.5; // 50% to 95%: the surface ahead
export const WALL_TOP = 0.5; // structures count from the middle of the frame down, center only
export const SURFACE_MIN_PCT = 25; // a band counts as one surface if it covers this much of the band
export const SURFACE_CONFIRM = 2; // fresh readings in a row before a surface change is accepted

// Distance words, in meters from the depth model.
// CLOSE_M matches the cane's reach (about 1.5 m) plus a margin.
export const CLOSE_M = 3; // under this: urgent, and blocks a side for steering
export const NEAR_M = 6; // 3 to 6 m: moving objects block; other objects are announced

// Alert ranges, in meters.
export const STAIRS_M = 9; // stairs warn from this far
export const DOOR_M = 6; // doors, center and side
export const SURFACE_M = 9; // surfaces ahead
export const WALL_PATH_M = 3; // a wall or building this close in the center path is urgent
export const WALL_NEAR_M = 6; // a wall or building approaching within this range gets a heads-up

// A moving object or structure is "approaching" if it got this many meters closer since the last reading.
export const APPROACH_M = 0.3;

// Ground thresholds, as percent of the frame or region.
export const OPEN_PCT = 15; // a side with this much floor and no blocker is "open"
export const NARROW_PCT = 5; // a side with this much floor is "narrow"
export const HAZARD_PCT = 3; // stairs anywhere in the frame
export const DOOR_PCT = 5; // door share of the frame, per zone
export const WALL_PCT = 15; // structure share of the center path region

// Processing and speech timing.
export const SEM_EVERY = 2; // run the semantic model every Nth cycle; ground is reused in between
export const REMINDER_MS = 10000; // repeat the "still ahead" reminder after this long
export const INFO_GAP_MS = 3000; // minimum time between information messages (tier 3)
