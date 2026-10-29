import { speakText, setOnFree, cancelSpeech } from "./speech.js";
import { confirmSpoken } from "./navigation.js";
import { REMINDER_MS, INFO_GAP_MS } from "./config.js";

// A subject (for example, the person on your left) isn't spoken again within this window,
// even if its wording or direction changes. Safety messages are exempt.
const TOPIC_COOLDOWN_MS = 8000;
// Quiet time after ordinary navigation speech, so a question can be asked between messages.
const NAV_GAP_MS = 3000;

let currentKey = null;
let lastSpokenAt = 0;
let lastInfoAt = 0;
let lastFreeAt = 0; // when speech last finished
let gapTimer = null;
let lastTopicAt = new Map();
let queued = null; // { key, text, tier, topic, safety }. Only the newest message is kept.
let held = false; // true while a question is being answered

// Speaks the queued message once speech is free. Sentences are never cut off.
// Ordinary navigation waits NAV_GAP_MS after the last speech. Safety messages don't wait.
// Information messages (tier 3) wait INFO_GAP_MS after the last one.
// Repeats of a recently spoken subject are dropped unless they're safety messages.
function attempt() {
	if (!queued) return;
	if (held) return;
	if (queued.key !== currentKey) {
		queued = null;
		return;
	}
	const now = Date.now();

	if (!queued.safety && now - lastFreeAt < NAV_GAP_MS) {
		if (!gapTimer) {
			gapTimer = setTimeout(
				() => {
					gapTimer = null;
					attempt();
				},
				NAV_GAP_MS - (now - lastFreeAt),
			);
		}
		return;
	}

	if (queued.tier === 3 && now - lastInfoAt < INFO_GAP_MS) return;

	if (!queued.safety && queued.topic) {
		const last = lastTopicAt.get(queued.topic);
		if (last !== undefined && now - last < TOPIC_COOLDOWN_MS) {
			queued = null;
			return;
		}
	}

	if (speakText(queued.text)) {
		if (queued.tier === 3) lastInfoAt = now;
		lastSpokenAt = now;
		if (queued.topic) lastTopicAt.set(queued.topic, now);
		if (queued.key.startsWith("on:") || queued.key === "clear:path")
			confirmSpoken(queued.key);
		queued = null;
	}
}

// Called by speech.js when speech finishes. Starts the quiet gap, then tries to speak.
setOnFree(() => {
	lastFreeAt = Date.now();
	attempt();
});

export function resetAlerts() {
	currentKey = null;
	lastSpokenAt = 0;
	lastInfoAt = 0;
	lastFreeAt = 0;
	clearTimeout(gapTimer);
	gapTimer = null;
	lastTopicAt = new Map();
	queued = null;
	held = false;
}

export function handleAlert(alert) {
	const now = Date.now();
	if (alert.key !== currentKey) {
		// A new situation replaces anything still waiting, so stale messages are dropped.
		currentKey = alert.key;
		queued = alert.text
			? {
					key: alert.key,
					text: alert.text,
					tier: alert.tier,
					topic: alert.topic,
					safety: alert.safety,
				}
			: null;
	} else if (!queued && alert.reminder && now - lastSpokenAt >= REMINDER_MS) {
		queued = {
			key: alert.key,
			text: alert.reminder,
			tier: alert.tier,
			topic: alert.topic,
			safety: alert.safety,
		};
	}
	attempt();
}

// Pauses navigation speech while a question is answered. Nothing is spoken during the hold.
export function setHold(on) {
	held = on;
	if (on) cancelSpeech();
	if (!on) attempt();
}
