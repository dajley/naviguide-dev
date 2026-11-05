// Answers scene questions in code, straight from the facts.
// Step 1: the words are matched against the names the camera sees, the floor, and walls.
// Step 2, only if nothing matches: a small embedding model picks the closest kind and name.
// Code always writes the answer. The model never writes facts.
export const OUT_OF_SCOPE =
	"I can't give directions. I can only tell you what I see in the camera and where it is.";
export const UNSURE = "I can't tell that from the camera.";
export const BEHIND = "I can't see behind you. The camera faces forward.";
export const NOT_SEEN = "I don't see anything I can name.";
export const HELP =
	"You can ask what do you see, is there, how many, where is, how far, what is close or around me, what is farthest, what is on my left or right, what is ahead, is anyone close, what am I standing on, or what is the floor like.";

const ALL_KINDS = new Set([
	"route",
	"nearest",
	"list",
	"count",
	"presence",
	"where",
	"distance",
	"floor_under",
	"floor_ahead",
	"wall",
	"other",
	"behind",
	"someone",
	"farthest",
	"clear",
	"side",
]);
const TOPIC_KINDS = new Set([
	"count",
	"presence",
	"where",
	"distance",
	"route",
]);
const WHERE = { left: "to your left", center: "ahead", right: "to your right" };
const EXIT_WORDS = /\b(emergency exit|exit|exits|way out)\b/g;
const ROUTE =
	/\b(get to|go to|route|direction|directions|way to|path|navigate|take me|walk to|how do i|how can i|where should i)\b/;
const BEHIND_Q = /\bbehind\b/;
const SOMEONE_Q = /\b(someone|somebody|anyone|anybody)\b/;
const FARTHEST_Q = /\b(farthest|furthest)\b/;
const CLEAR_Q = /\b(clear|blocked|free|obstructed)\b/;
const PATH_WORD = /\b(path|way)\b/;
const SIDE_Q = /\b(?:on|to) my (left|right)\b|\bmy (left|right) side\b/;
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

// Checks the model's match. Anything unexpected is thrown away.
// A topic that isn't in the camera's list comes back with topic null, so the app says it can't tell.
function checkIntent(raw, scene) {
	if (!raw || typeof raw !== "object" || !ALL_KINDS.has(raw.kind)) return null;
	if (!TOPIC_KINDS.has(raw.kind)) return { kind: raw.kind, topic: null };
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

// Doors and stairs are regions, so they get yes or no with their position, not a count.
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

// "2 meters" or "1 meter".
function meters(m) {
	return `${m} ${m === 1 ? "meter" : "meters"}`;
}

// "2 meters to your left", or "2 meters away" when the side is already said.
function placeOf(zone, m, short = false) {
	return short ? `${meters(m)} away` : `${meters(m)} ${WHERE[zone]}`;
}

// Builds one spoken item per name and zone. Same-name items in one zone are grouped,
// so a crowd is one phrase. Doors and stairs stay as places, one per zone.
function itemsFrom(scene, zone = null, short = false) {
	const groups = new Map();
	for (const d of scene.detections ?? []) {
		if (zone && d.zone !== zone) continue;
		const key = `${d.name}|${d.zone}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(d);
	}
	const items = [];
	for (const group of groups.values()) {
		group.sort((a, b) => a.distance_m - b.distance_m);
		const first = group[0];
		let text;
		if (group.length === 1) {
			text = `${article(first.name)} ${first.name} ${placeOf(first.zone, first.distance_m, short)}`;
		} else {
			const where = short ? "" : ` ${WHERE[first.zone]}`;
			text = `${numberWord(group.length)} ${plural(first.name)}${where}, the closest ${meters(first.distance_m)} away`;
		}
		items.push({ dist: first.distance_m, text });
	}
	for (const d of scene.facts.doors?.places ?? []) {
		if (zone && d.zone !== zone) continue;
		items.push({
			dist: d.distance_m,
			text: `a door ${placeOf(d.zone, d.distance_m, short)}`,
		});
	}
	for (const s of scene.facts.stairs?.places ?? []) {
		if (zone && s.zone !== zone) continue;
		items.push({
			dist: s.distance_m,
			text: `stairs ${placeOf(s.zone, s.distance_m, short)}`,
		});
	}
	return items;
}

// Speaks the nearest items first, up to the limit.
function speakItems(items) {
	items.sort((a, b) => a.dist - b.dist);
	return joinList(items.slice(0, LIST_LIMIT).map((i) => i.text));
}

function listAnswer(scene) {
	const items = itemsFrom(scene);
	if (items.length === 0) return NOT_SEEN;
	return `I see ${speakItems(items)}.`;
}

// What is on one side, for "what is on my left" and "what is on my right".
function sideAnswer(scene, zone) {
	const side = zone === "left" ? "left" : "right";
	const items = itemsFrom(scene, zone, true);
	if (items.length === 0) return `I don't see anything on your ${side}.`;
	return `On your ${side}, I see ${speakItems(items)}.`;
}

// What is straight ahead. It reports what it sees and never says the way is clear.
function aheadAnswer(scene) {
	const items = itemsFrom(scene, "center", true);
	if (items.length === 0) return "I don't see anything ahead.";
	return `Ahead, I see ${speakItems(items)}.`;
}

// The farthest thing the camera can name, using the same distances as the list.
function farthestAnswer(scene) {
	const all = scene.detections ?? [];
	if (all.length === 0) return NOT_SEEN;
	const far = all.reduce((a, b) => (b.distance_m > a.distance_m ? b : a));
	return `The farthest is ${article(far.name)} ${far.name}, ${placeOf(far.zone, far.distance_m)}.`;
}

// The closest person, with where they are. Does not judge whether they count as close.
function someoneAnswer(scene) {
	const people = (scene.detections ?? []).filter((d) => d.name === "person");
	if (people.length === 0) return "I don't see anyone.";
	const p = people.reduce((a, b) => (b.distance_m < a.distance_m ? b : a));
	return `The closest person is ${placeOf(p.zone, p.distance_m)}.`;
}

// A route question gets where the target is, if the camera sees it. It never gives steps.
function routeAnswer(topic, facts) {
	if (!topic) return OUT_OF_SCOPE;
	return whereAnswer(topic, facts);
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
// Exit words are read as "door" first, so "where is the exit" is a question about the door.
export function parseQuestion(question, scene) {
	const q = question.toLowerCase().replace(EXIT_WORDS, "door");
	const topic = topicOf(q, scene);

	if (BEHIND_Q.test(q) && !topic) return { kind: "behind", topic: null };
	if (SOMEONE_Q.test(q)) return { kind: "someone", topic: null };
	if (FARTHEST_Q.test(q)) return { kind: "farthest", topic: null };
	if (CLEAR_Q.test(q) && (AHEAD_WORD.test(q) || PATH_WORD.test(q)))
		return { kind: "clear", topic: null };
	if (ROUTE.test(q)) return { kind: "route", topic };
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

	if (!topic) {
		const side = q.match(SIDE_Q);
		if (side) return { kind: "side", topic: null, zone: side[1] || side[2] };
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

// Code first. If no pattern matches, the embedding model picks the closest kind and name.
// "interpret" is the matching function, or null when the model isn't loaded.
export async function respond(scene, question, interpret) {
	let parsed = parseQuestion(question, scene);
	if (!parsed && interpret) {
		const label = checkIntent(await interpret(question, namesOf(scene)), scene);
		// Code decides count questions: a "how many" question is always a count.
		const isCount = COUNT.test(question.toLowerCase());
		parsed =
			isCount && label && TOPIC_KINDS.has(label.kind)
				? { ...label, kind: "count" }
				: label;
	}
	if (!parsed) return HELP;
	const facts = scene.facts;
	const q = question.toLowerCase();

	if (parsed.kind === "other") return UNSURE;
	if (parsed.kind === "behind") return BEHIND;
	if (parsed.kind === "someone") return someoneAnswer(scene);
	if (parsed.kind === "farthest") return farthestAnswer(scene);
	if (parsed.kind === "clear") return aheadAnswer(scene);
	if (parsed.kind === "side") {
		const zone =
			parsed.zone ??
			(/\bright\b/.test(q) ? "right" : /\bleft\b/.test(q) ? "left" : null);
		return zone ? sideAnswer(scene, zone) : UNSURE;
	}
	if (parsed.kind === "route") return routeAnswer(parsed.topic, facts);
	if (parsed.kind === "wall")
		return wallAnswer(parsed.sub ?? "presence", facts.wall_or_building ?? null);
	if (parsed.kind === "floor_ahead")
		return floorAheadAnswer(facts.ground ?? {});
	if (parsed.kind === "floor_under")
		return floorUnderAnswer(facts.ground ?? {});
	if (parsed.kind === "nearest") return nearestAnswer(facts);
	if (parsed.kind === "list") return listAnswer(scene);
	if (!parsed.topic) return UNSURE;
	return answerFor(parsed, scene);
}
