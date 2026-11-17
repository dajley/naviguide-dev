// Turns the segmentation model's raw output into a list of detected objects, each with a
// label, a zone (left, center, or right), and a box. Also removes duplicate boxes.
// Used by worker-core.js.
import { MOVING_CLASSES } from "./config.js";
import { zoneOfX } from "./geometry.js";

// Standard 80 COCO class names, in model index order.
export const COCO = [
	"person",
	"bicycle",
	"car",
	"motorcycle",
	"airplane",
	"bus",
	"train",
	"truck",
	"boat",
	"traffic light",
	"fire hydrant",
	"stop sign",
	"parking meter",
	"bench",
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
	"backpack",
	"umbrella",
	"handbag",
	"tie",
	"suitcase",
	"frisbee",
	"skis",
	"snowboard",
	"sports ball",
	"kite",
	"baseball bat",
	"baseball glove",
	"skateboard",
	"surfboard",
	"tennis racket",
	"bottle",
	"wine glass",
	"cup",
	"fork",
	"knife",
	"spoon",
	"bowl",
	"banana",
	"apple",
	"sandwich",
	"orange",
	"broccoli",
	"carrot",
	"hot dog",
	"pizza",
	"donut",
	"cake",
	"chair",
	"couch",
	"potted plant",
	"bed",
	"dining table",
	"toilet",
	"tv",
	"laptop",
	"mouse",
	"remote",
	"keyboard",
	"cell phone",
	"microwave",
	"oven",
	"toaster",
	"sink",
	"refrigerator",
	"book",
	"clock",
	"vase",
	"scissors",
	"teddy bear",
	"hair drier",
	"toothbrush",
];

const COEFF_START = 84; // rows 84 to 115 of output0 hold the 32 mask coefficients
const COEFF_COUNT = 32;

// Detection settings.
const MIN_SCORE = 0.35; // weaker candidates are dropped before suppression
const SAME_CLASS_IOU = 0.3; // same label, overlapping this much: one object
const CONTAIN = 0.7; // same label, one box mostly inside the other: one object
const CROSS_CLASS_IOU = 0.6; // different labels covering almost the same area: one object

// tensor dims are [1, 116, N]. Rows 0-3 are box center x, center y, width, height
// (in 640px input pixels). Rows 4-83 are the 80 class scores. Rows 84-115 are mask coefficients.
export function decodeDetections(t, threshold = MIN_SCORE) {
	const N = t.dims[2];
	const d = t.data;
	const candidates = [];

	for (let i = 0; i < N; i++) {
		let best = -1;
		let bestScore = 0;
		for (let c = 0; c < 80; c++) {
			const s = d[(4 + c) * N + i];
			if (s > bestScore) {
				bestScore = s;
				best = c;
			}
		}
		if (bestScore >= threshold) {
			const cx = d[i];
			const cy = d[N + i];
			const w = d[2 * N + i];
			const h = d[3 * N + i];
			const coeffs = new Float32Array(COEFF_COUNT);
			for (let k = 0; k < COEFF_COUNT; k++) {
				coeffs[k] = d[(COEFF_START + k) * N + i];
			}
			candidates.push({
				cls: best,
				score: bestScore,
				x1: cx - w / 2,
				y1: cy - h / 2,
				x2: cx + w / 2,
				y2: cy + h / 2,
				coeffs,
			});
		}
	}

	return suppress(candidates).map((det) => {
		const label = COCO[det.cls];
		return {
			label,
			kind: MOVING_CLASSES.has(label) ? "moving" : "general",
			score: det.score,
			zone: zoneOfX((det.x1 + det.x2) / 2),
			box: [det.x1, det.y1, det.x2, det.y2],
			coeffs: det.coeffs,
		};
	});
}

function area(b) {
	return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
}

// Intersection of two boxes, as a share of the smaller box's area.
function overlapStats(a, b) {
	const x1 = Math.max(a.x1, b.x1);
	const y1 = Math.max(a.y1, b.y1);
	const x2 = Math.min(a.x2, b.x2);
	const y2 = Math.min(a.y2, b.y2);
	const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
	const union = area(a) + area(b) - inter;
	const smaller = Math.min(area(a), area(b));
	return {
		iou: union > 0 ? inter / union : 0,
		contain: smaller > 0 ? inter / smaller : 0,
	};
}

// Keeps the strongest box for each object. Same-label boxes that overlap, or that one
// mostly contains, are the same object. Different labels that cover almost the same
// area are also the same object, and only the stronger label is kept.
function suppress(list) {
	list.sort((a, b) => b.score - a.score);
	const keep = [];
	for (const c of list) {
		const duplicate = keep.some((k) => {
			const { iou, contain } = overlapStats(k, c);
			if (k.cls === c.cls) return iou >= SAME_CLASS_IOU || contain >= CONTAIN;
			return iou >= CROSS_CLASS_IOU;
		});
		if (!duplicate) keep.push(c);
	}
	return keep;
}
