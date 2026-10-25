// Matches a question to a kind of question and to a name in the scene, using a small embedding model.
// The model only picks the closest match. Code writes every answer.
import { pipeline, env } from "../vendor/minilm/transformers.web.min.js";

const MODEL_NAME = "minilm";
const KIND_MIN = 0.35; // below this, the question is not close enough to any kind
const NAME_MIN = 0.5; // below this, no name in the scene fits the question

// Example phrasings for each kind of question. "other" is for things the app can't answer.
const EXAMPLES = {
	count: [
		"how many chairs are there",
		"what is the number of books",
		"count the cups",
	],
	presence: ["is there a door", "do you see a dog", "are there any stairs"],
	where: [
		"where is the book",
		"where is the door",
		"which direction is the chair",
	],
	distance: [
		"how far is the door",
		"how far away is the wall",
		"how close is the chair",
	],
	nearest: ["what is close to me", "what is in front of me", "what is nearby"],
	list: ["what objects are there", "what can you see", "what is around me"],
	floor_under: [
		"what am I standing on",
		"what kind of floor is this",
		"what is under my feet",
	],
	floor_ahead: [
		"what is the ground ahead like",
		"what is the floor in front of me",
		"what is ahead on the ground",
	],
	wall: [
		"is there a wall ahead",
		"how far is the wall",
		"is there a building in front",
	],
	route: [
		"how do I get to the door",
		"take me to the stairs",
		"which way is the exit",
	],
	other: [
		"what color is the chair",
		"what does the sign say",
		"is the book open",
		"is it raining",
	],
};

let extractor = null;
let ready = false;
let exampleVecs = [];
const nameVecs = new Map();

export function isReady() {
	return ready;
}

function dot(a, b) {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

// Turns text into a normalized vector, so a plain dot product gives similarity.
async function vectorOf(text) {
	const result = await extractor(text, { pooling: "mean", normalize: true });
	return result.tolist()[0];
}

async function nameVec(name) {
	if (!nameVecs.has(name)) nameVecs.set(name, await vectorOf(name));
	return nameVecs.get(name);
}

// Loads the model from the project's models folder, and embeds the example phrasings once.
export async function loadAnswerModel(onProgress) {
	if (extractor) return;
	env.allowLocalModels = true;
	env.allowRemoteModels = false;
	env.backends.onnx.wasm.wasmPaths = new URL(
		"../vendor/minilm/",
		import.meta.url,
	).href;
	env.localModelPath = new URL("../models/", import.meta.url).href;
	extractor = await pipeline("feature-extraction", MODEL_NAME, {
		dtype: "q8",
		progress_callback: (p) => onProgress?.(p.status ?? ""),
	});
	const vecs = [];
	for (const [kind, phrases] of Object.entries(EXAMPLES)) {
		for (const p of phrases) vecs.push({ kind, vec: await vectorOf(p) });
	}
	exampleVecs = vecs;
	ready = true;
}

// Returns { kind, topic } for a question the patterns didn't match, or null if nothing fits.
// topic is null when no name in the scene is close enough.
export async function interpretQuestion(question, names = []) {
	if (!ready) return null;
	try {
		const qv = await vectorOf(question);

		let kind = null;
		let kindScore = -Infinity;
		for (const e of exampleVecs) {
			const s = dot(qv, e.vec);
			if (s > kindScore) {
				kindScore = s;
				kind = e.kind;
			}
		}
		if (!kind || kindScore < KIND_MIN) return null;
		if (kind === "other") return { kind: "other", topic: null };

		let topic = null;
		let nameScore = -Infinity;
		for (const name of names) {
			const s = dot(qv, await nameVec(name));
			if (s > nameScore) {
				nameScore = s;
				topic = name;
			}
		}
		if (nameScore < NAME_MIN) topic = null;

		console.log(
			"match:",
			kind,
			kindScore.toFixed(2),
			topic,
			nameScore.toFixed(2),
		);
		return { kind, topic };
	} catch (err) {
		console.warn("match failed:", err);
		return null;
	}
}
