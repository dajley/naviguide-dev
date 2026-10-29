// Voice commands and questions, using Moonshine (offline speech recognition).
// Listening is paused until the intro's instructions finish (resume() is called then).
// Start and stop work in any order. A question cue opens the question window when two of
// "navi," "have," or "question" are heard in the same pickup, in any order.
import * as Moonshine from "./vendor/moonshine/moonshine.min.js";

const MODEL_PATH = "models/moonshine-tiny";
const QUESTION_WINDOW_MS = 6000;
const WINDOW_DELAY_MS = 1000; // gives the prompt's transcript time to arrive before the window opens
const SPEECH_TAIL_MS = 3000; // the app's recent words are remembered this long
const ECHO_MIN_WORDS = 3;
const ECHO_MATCH = 0.8;

// Words Moonshine sometimes writes for "navi."
const NAVI_WORDS = ["navi", "navy", "nabi", "navvy"];
const HAVE_WORDS = ["have"];
const QUESTION_WORDS = ["question"];
const CUE_MIN_GROUPS = 2; // how many of the three groups must be heard

export function createVoice({
	onStart,
	onStop,
	isRunning,
	onQuestionOpen,
	onRetry,
	onQuestionTimeout,
	onQuestion,
	onStatus,
	onReady,
}) {
	let transcriber = null;
	let paused = true; // true until the intro's instructions are finished
	let inQuestion = false; // from the cue until answered or timed out
	let questionOpen = false; // the 6-second window itself
	let questionTimer = null;
	let attempts = 0;
	let recentSpeech = { words: new Set(), until: 0 };

	function words(text) {
		return text
			.toLowerCase()
			.replace(/[^a-z ]/g, " ")
			.split(/\s+/)
			.filter(Boolean);
	}

	// The app calls this right before it speaks, so its echo can be recognized.
	function noteSpeech(text) {
		const duration = text.length * 80 + SPEECH_TAIL_MS;
		recentSpeech = {
			words: new Set(words(text)),
			until: Date.now() + duration,
		};
	}

	// Every word matches what the app just said, at any length. Catches a one-word "yes".
	function isRecentSpeech(list) {
		if (Date.now() > recentSpeech.until) return false;
		return list.every((w) => recentSpeech.words.has(w));
	}

	// Longer phrases count as echo when most of their words match what the app just said.
	function isEcho(list) {
		if (Date.now() > recentSpeech.until) return false;
		if (list.length < ECHO_MIN_WORDS) return false;
		const matched = list.filter((w) => recentSpeech.words.has(w)).length;
		return matched / list.length >= ECHO_MATCH;
	}

	// True when enough of the cue groups are heard, in any order.
	function isCue(list) {
		const groups = [NAVI_WORDS, HAVE_WORDS, QUESTION_WORDS];
		const heard = groups.filter((group) => group.some((w) => list.includes(w)));
		return heard.length >= CUE_MIN_GROUPS;
	}

	function isAppSpeaking() {
		return !!window.speechSynthesis?.speaking;
	}

	function endQuestion() {
		inQuestion = false;
		questionOpen = false;
		clearTimeout(questionTimer);
	}

	// Opens the window only after the app has finished speaking, plus a short delay,
	// so the prompt's transcript arrives before the window opens.
	function startWindowWhenQuiet() {
		clearTimeout(questionTimer);
		const check = () => {
			if (isAppSpeaking()) {
				questionTimer = setTimeout(check, 200);
				return;
			}
			questionTimer = setTimeout(() => {
				questionOpen = true;
				questionTimer = setTimeout(onWindowTimeout, QUESTION_WINDOW_MS);
			}, WINDOW_DELAY_MS);
		};
		questionTimer = setTimeout(check, 300);
	}

	function openQuestion() {
		inQuestion = true;
		attempts = 0;
		onQuestionOpen?.();
		startWindowWhenQuiet();
	}

	function onWindowTimeout() {
		questionOpen = false;
		attempts++;
		if (attempts === 1) {
			// First miss: say so, then give one more 6-second window.
			onRetry?.();
			startWindowWhenQuiet();
			return;
		}
		endQuestion();
		onQuestionTimeout?.();
	}

	function handle(text) {
		console.log("committed:", text);
		if (paused) return;
		const list = words(text);
		if (list.length === 0) return;

		const startsNavi = list[0] === "navi";
		const rest = startsNavi ? list.slice(1).join(" ") : "";

		// Stop works even while the app is speaking. It needs "stop" and "navigation," in any order.
		if (list.includes("stop") && list.includes("navigation")) {
			onStop?.();
			return;
		}

		// Start works in any order whenever the app isn't running.
		// Its own "Navigation started." is heard while running, so it's ignored.
		if (
			!isRunning?.() &&
			list.includes("start") &&
			list.includes("navigation")
		) {
			onStart?.();
			return;
		}

		// The app's own speech is ignored from here on.
		if (isRecentSpeech(list) || isEcho(list)) return;

		// During a question, the next phrase is the question.
		// Cues during a question are ignored, so a repeat can't reopen it.
		if (inQuestion) {
			if (!questionOpen) return;
			if (isAppSpeaking()) return;
			endQuestion();
			onQuestion?.(list.join(" "));
			return;
		}

		// Outside a question, the cue opens the window.
		if (isCue(list)) {
			openQuestion();
		}
	}

	return {
		noteSpeech,

		// Called when the intro's instructions are finished.
		resume() {
			paused = false;
		},

		async listen() {
			if (transcriber) return;
			try {
				onStatus?.("Loading voice model. This can take a moment.");
				transcriber = new Moonshine.MicrophoneTranscriber(
					MODEL_PATH,
					{
						onTranscriptionUpdated: (text) => console.log("updated:", text),
						onTranscriptionCommitted: handle,
					},
					true,
				);
				await transcriber.start();
				onStatus?.(
					'Voice on. Say "Navi, start navigation" or press the Start button to begin.',
				);
				onReady?.();
			} catch (err) {
				transcriber = null;
				onStatus?.(`Voice unavailable: ${err.message}`);
			}
		},
	};
}
