const SIZE = 640;

// Min and max over the whole depth map, to check the value range.
export function depthRange(map) {
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < map.data.length; i++) {
		const v = map.data[i];
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return { min, max };
}

// Depth near the bottom-center of a detection box, where the object meets the ground.
// Takes the median of a small patch so one noisy pixel doesn't decide the value.
export function depthAt(map, box) {
	const [x1, , x2, y2] = box;
	const cx = Math.round((x1 + x2) / 2);
	const cy = Math.round(Math.min(y2, SIZE - 1));
	const vals = [];
	for (let dy = -6; dy <= 6; dy += 3) {
		for (let dx = -6; dx <= 6; dx += 3) {
			const x = Math.min(SIZE - 1, Math.max(0, cx + dx));
			const y = Math.min(SIZE - 1, Math.max(0, cy + dy));
			vals.push(map.data[y * SIZE + x]);
		}
	}
	vals.sort((a, b) => a - b);
	return vals[Math.floor(vals.length / 2)];
}
