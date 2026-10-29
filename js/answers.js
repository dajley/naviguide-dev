// Answers scene questions in code, straight from the facts.
// Step 1: the words are matched against the names the camera sees, the floor, and walls.
// Step 2, only if nothing matches: the language model picks the closest name from the camera's list.
// Code always writes the answer. The model never writes facts.
export const OUT_OF_SCOPE = "I can only describe what is around you right now.";
export const UNSURE = "I can't tell that from the camera.";
export const HELP =
	"You can ask how many, is there, where is, how far, what is close, what is around me, or what is the floor like.";

const KINDS = new Set([
	"route",
	"nearest",
	"list",
	"count",
	"presence",
	"where",
	"distance",
]);
const ROUTE =
	/\b(get to|go to|route|direction|directions|way to|path|navigate|take me|walk to|how do i|how can i|where should i)\b/;
const WALL_Q = /\b(wall|walls|building|buildings)\b/;
const GROUND_WORD = /\b(ground|floor|surface)\b/;
const AHEAD_WORD = /\b(ahead|in front|forward)\b/;
const UNDER_Q =
	/\b(standing on|stand on|under my feet|under me|what am i on|floor|ground|surface)\b/;
const NEAREST = /\b(close|closest|nearest|near me|nearby|in front|around me)\b/;
const LIST =
	/\b(what|which)\b.*\b(objects?|things?|items?|there)\b|\bwhat do you see\b|\bwhat can you see\b|\beverything\b/;
const DISTANCE = /\b(how far|farther|distance)\b/;
const COUNT = /\b(how many|number of|count)\b/;
const WHERE_Q = /\bwhere\b/;
const LIST_LIMIT = 5;

const NUMBER_WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
];

// Common words that mean one of the camera's names. Used only when that name is in the snapshot.
// Add to this list when a real question uses a word that isn't covered.
const SYNONYMS = {
	seat: "chair",
	seats: "chair",
	stool: "chair",
	stools: "chair",
	armchair: "chair",
	sofa: "couch",
	sofas: "couch",
	loveseat: "couch",
	table: "dining table",
	tables: "dining table",
	man: "person",
	men: "person",
	woman: "person",
	women: "person",
	child: "person",
	children: "person",
	kid: "person",
	kids: "person",
	car: "car",
	cars: "car",
	bike: "bicycle",
	bikes: "bicycle",
};

// Turns a word into the name used in the snapshot.
function singular(word) {
	if (word === "people" || word === "persons") return "person";
	if (word.endsWith("ss")) return word;
	if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
	return word;
}

function plural(label) {
	if (label === "person") return "people";
	return label.endsWith("s") ? label : `${label}s`;
}

function article(label) {
	return /^[aeiou]/.test(label) ? "an" : "a";
}

function cap(text) {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function numberWord(n) {
	return n <= 10 ? NUMBER_WORDS[n] : String(n);
}

// Joins items into speech: "a", "a and b", "a, b, and c".
function joinList(items) {
	if (items.length === 1) return items[0];
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function escapeRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every name the camera can answer about: the fixed places plus what it sees now.
export function namesOf(scene) {
	const names = [
		"door",
		"stairs",
		"person",
		...Object.keys(scene.facts.objects_by_name),
	];
	return [...new Set(names)];
}

// Turns the model's topic into a name the code understands.
function cleanTopic(raw) {
	if (typeof raw !== "string") return null;
	const w = raw
		.toLowerCase()
		.replace(/[^a-z ]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!w) return null;
	if (/\bdoors?\b/.test(w)) return "door";
	if (/\b(stairs?|stairway|steps?)\b/.test(w)) return "stairs";
	if (/\b(people|persons?)\b/.test(w)) return "person";
	const s = singular(w);
	return SYNONYMS[w] ?? SYNONYMS[s] ?? s;
}

// Checks the model's label. Anything unexpected is thrown away.
// A topic that isn't in the camera's list comes back with topic null, so the app says it can't tell.
function checkIntent(raw, scene) {
	if (!raw || typeof raw !== "object" || !KINDS.has(raw.kind)) return null;
	if (
		raw.kind !== "presence" &&
		raw.kind !== "count" &&
		raw.kind !== "where" &&
		raw.kind !== "distance"
	) {
		return { kind: raw.kind, topic: null };
	}
	const topic = cleanTopic(raw.topic);
	if (!topic || !namesOf(scene).includes(topic))
		return { kind: raw.kind, topic: null };
	return { kind: raw.kind, topic };
}

// The name the question asks about, only if the camera's list has it.
function topicOf(q, scene) {
	if (/\bdoors?\b/.test(q)) return "door";
	if (/\b(stairs?|stairway|steps?)\b/.test(q)) return "stairs";
	if (/\b(people|persons?)\b/.test(q)) return "person";
	const names = Object.keys(scene.facts.objects_by_name);
	for (const name of names) {
		const pattern = new RegExp(`\\b${escapeRegex(name)}(s|es)?\\b`);
		if (pattern.test(q)) return name;
	}
	for (const [word, name] of Object.entries(SYNONYMS)) {
		if (names.includes(name) && new RegExp(`\\b${word}\\b`).test(q))
			return name;
	}
	return null;
}

function placesFor(topic, facts) {
	if (topic === "door") return facts.doors.places;
	if (topic === "stairs") return facts.stairs.places;
	return facts.objects_by_name[topic]?.places ?? [];
}

function labelOf(topic) {
	return topic === "door" ? "door" : topic === "stairs" ? "stairs" : topic;
}

// Doors and stairs always include the zone and distance, from the phrase.
function presenceAnswer(topic, facts) {
	const places = placesFor(topic, facts);
	if (topic === "stairs") {
		if (places.length === 0) return "No, I don't see stairs.";
		return `Yes, stairs, ${places[0].phrase}.`;
	}
	const label = labelOf(topic);
	if (places.length === 0) return `No, I don't see ${article(label)} ${label}.`;
	return `Yes, ${article(label)} ${label}, ${places[0].phrase}.`;
}

function countAnswer(topic, facts) {
	const count = facts.objects_by_name[topic]?.count ?? 0;
	if (count === 0) return `There are no ${plural(topic)}.`;
	if (count === 1) return `There is one ${topic}.`;
	return `There are ${numberWord(count)} ${plural(topic)}.`;
}

function whereAnswer(topic, facts) {
	const places = placesFor(topic, facts);
	const label = labelOf(topic);
	if (places.length === 0) return `I don't see ${article(label)} ${label}.`;
	const verb = topic === "stairs" ? "are" : "is";
	return `The ${label} ${verb} ${places[0].phrase}.`;
}

function distanceAnswer(topic, facts) {
	const places = placesFor(topic, facts);
	const label = labelOf(topic);
	if (places.length === 0) return `I don't see ${article(label)} ${label}.`;
	const verb = topic === "stairs" ? "are" : "is";
	return `The nearest ${label} ${verb} ${places[0].phrase}.`;
}

function nearestAnswer(facts) {
	const n = facts.nearest_objects[0];
	if (!n) return "I don't see anything close.";
	return `The closest is ${article(n.name)} ${n.phrase}.`;
}

// Lists what the camera sees, nearest first, in one sentence.
function listAnswer(facts) {
	const items = [];
	for (const [name, info] of Object.entries(facts.objects_by_name)) {
		if (!info.count || !info.places?.length) continue;
		const p = info.places[0];
		const text =
			info.count === 1
				? `${article(name)} ${name} ${p.phrase}`
				: `${numberWord(info.count)} ${plural(name)} with the closest ${p.phrase}`;
		items.push({ dist: p.distance_m, text });
	}
	if (facts.doors.places.length) {
		const d = facts.doors.places[0];
		items.push({ dist: d.distance_m, text: `a door ${d.phrase}` });
	}
	if (facts.stairs.places.length) {
		const s = facts.stairs.places[0];
		items.push({ dist: s.distance_m, text: `stairs ${s.phrase}` });
	}
	if (items.length === 0) return "I don't see anything I can name.";
	items.sort((a, b) => a.dist - b.dist);
	const shown = items.slice(0, LIST_LIMIT).map((i) => i.text);
	return `I see ${joinList(shown)}.`;
}

// Floor answers. Each one says what is missing when the camera has no reading.
function floorUnderAnswer(ground) {
	if (!ground.under_user)
		return "I can't tell what you're standing on right now.";
	return `You're standing on the ${ground.under_user}.`;
}

function floorAheadAnswer(ground) {
	if (!ground.ahead) return "I can't tell what the ground ahead is right now.";
	const m = ground.ahead_distance_m;
	if (m == null) return `The ${ground.ahead} ahead.`;
	return `The ${ground.ahead} ahead starts ${m} meters away.`;
}

// Wall answers. The wall or building is the one straight ahead.
function wallAnswer(sub, wall) {
	if (!wall) return "I don't see a wall or building ahead.";
	const label = wall.name;
	const m = wall.distance_m;
	if (sub === "presence") {
		return `Yes, ${article(label)} ${label}${m == null ? " ahead." : `, ${m} meters ahead.`}`;
	}
	if (m == null) return `The ${label} is ahead.`;
	return `The ${label} is ${m} meters ahead.`;
}

// Matches the words against the camera's names. Returns { kind, topic }, or null if no pattern fits.
export function parseQuestion(question, scene) {
	const q = question.toLowerCase();
	if (ROUTE.test(q)) return { kind: "route", topic: null };
	if (WALL_Q.test(q)) {
		const sub = DISTANCE.test(q)
			? "distance"
			: WHERE_Q.test(q)
				? "where"
				: "presence";
		return { kind: "wall", sub };
	}
	if (GROUND_WORD.test(q) && AHEAD_WORD.test(q))
		return { kind: "floor_ahead", topic: null };
	if (UNDER_Q.test(q)) return { kind: "floor_under", topic: null };
	const topic = topicOf(q, scene);
	if (!topic) {
		if (NEAREST.test(q)) return { kind: "nearest", topic: null };
		if (LIST.test(q)) return { kind: "list", topic: null };
		return null;
	}
	if (COUNT.test(q)) return { kind: "count", topic };
	if (DISTANCE.test(q)) return { kind: "distance", topic };
	if (WHERE_Q.test(q)) return { kind: "where", topic };
	return { kind: "presence", topic };
}

// Writes the answer for a parsed question. Doors and stairs get presence, not counts.
function answerFor(parsed, scene) {
	const { kind, topic } = parsed;
	const facts = scene.facts;
	const isPlace = topic === "door" || topic === "stairs";
	if (kind === "count") {
		return isPlace ? presenceAnswer(topic, facts) : countAnswer(topic, facts);
	}
	if (kind === "distance") return distanceAnswer(topic, facts);
	if (kind === "where") return whereAnswer(topic, facts);
	return presenceAnswer(topic, facts);
}

// Code first. If no pattern matches, the model picks a name from the camera's list.
// "interpret" is the model's labeling function, or null when the model isn't loaded.
export async function respond(scene, question, interpret) {
	let parsed = parseQuestion(question, scene);
	if (!parsed && interpret) {
		const label = checkIntent(await interpret(question, namesOf(scene)), scene);
		// Code decides count questions: a "how many" question is always a count.
		const isCount = COUNT.test(question.toLowerCase());
		const countable =
			label &&
			label.kind !== "route" &&
			label.kind !== "nearest" &&
			label.kind !== "list";
		parsed = isCount && countable ? { ...label, kind: "count" } : label;
	}
	if (!parsed) return HELP;
	const facts = scene.facts;
	if (parsed.kind === "route") return OUT_OF_SCOPE;
	if (parsed.kind === "wall")
		return wallAnswer(parsed.sub, facts.wall_or_building ?? null);
	if (parsed.kind === "floor_ahead")
		return floorAheadAnswer(facts.ground ?? {});
	if (parsed.kind === "floor_under")
		return floorUnderAnswer(facts.ground ?? {});
	if (parsed.kind === "nearest") return nearestAnswer(facts);
	if (parsed.kind === "list") return listAnswer(facts);
	if (!parsed.topic) return UNSURE;
	return answerFor(parsed, scene);
}
