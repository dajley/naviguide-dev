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
		"how many people are here",
		"how many cars do you see",
		"how many bikes are around",
	],
	presence: [
		"is there a door",
		"do you see a dog",
		"are there any stairs",
		"is there a chair in the room",
		"is a person here",
		"can you see a bottle",
		"is there an exit door",
		"is there a way out",
	],
	where: [
		"where is the book",
		"where is the door",
		"which direction is the chair",
		"where are the stairs",
		"where is the exit",
		"where is the way out",
		"where is the person",
	],
	distance: [
		"how far is the door",
		"how far away is the wall",
		"how close is the chair",
		"how far is the person",
		"how far to the stairs",
		"how far to the exit",
	],
	nearest: [
		"what is close to me",
		"what is in front of me",
		"what is nearby",
		"what is around me",
		"what is the closest thing",
		"what is near me",
	],
	list: [
		"what objects are there",
		"what can you see",
		"what do you see",
		"tell me what you see",
		"describe the room",
		"what is here",
	],
	floor_under: [
		"what am I standing on",
		"what kind of floor is this",
		"what is under my feet",
		"what surface am I on",
	],
	floor_ahead: [
		"what is the ground ahead like",
		"what is the floor in front of me",
		"what is ahead on the ground",
		"what kind of path is ahead",
	],
	wall: [
		"is there a wall ahead",
		"how far is the wall",
		"is there a building in front",
		"what is the wall in front of me",
	],
	route: [
		"how do I get to the door",
		"take me to the stairs",
		"which way is the exit",
		"how do I get out",
		"how do I get to the bathroom",
	],
	behind: [
		"what is behind me",
		"is there anything behind me",
		"what is at my back",
	],
	someone: [
		"is anyone close",
		"is someone near me",
		"is somebody next to me",
		"is there a person close to me",
	],
	farthest: [
		"what is farthest",
		"what is the furthest thing",
		"what is farthest away",
		"what is the most distant thing",
	],
	clear: [
		"is the way ahead clear",
		"is my path clear",
		"is it clear in front of me",
		"is anything blocking my path",
		"is the way ahead free",
	],
	side: [
		"what is on my left",
		"what is on my right",
		"what is to my left",
		"what is to my right",
		"what is on the left side",
		"what is on the right side",
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
