const supported = "speechSynthesis" in window;
let voice = null;
let busy = false;
let token = 0;
let onFree = null;
let onSpeak = null;
let watchdog = null;

function pickVoice() {
	const voices = speechSynthesis.getVoices();
	// The browser's default English voice if it runs on the device, so it works offline.
	// Otherwise the first English voice on the device.
	voice =
		voices.find(
			(v) => v.default && v.localService && v.lang.startsWith("en"),
		) ||
		voices.find((v) => v.localService && v.lang.startsWith("en")) ||
		null;
}

if (supported) {
	pickVoice();
	speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

// Called by alerts.js when speech finishes, so a waiting message can be spoken.
export function setOnFree(cb) {
	onFree = cb;
}

// Called by voice.js so the mic's echo of each spoken line can be dropped.
export function setOnSpeak(cb) {
	onSpeak = cb;
}

// Marks speech as finished and lets the next message start.
function freeNow(my) {
	if (my !== token) return;
	busy = false;
	clearTimeout(watchdog);
	if (onFree) onFree();
}

// Fallback for browsers that never report the end of an utterance. It waits while the
// browser is still speaking, and gives up after a few extra seconds so the queue can't stall.
function checkWatchdog(my, endAt) {
	if (my !== token) return;
	const now = Date.now();
	if ((now < endAt || speechSynthesis.speaking) && now < endAt + 5000) {
		watchdog = setTimeout(() => checkWatchdog(my, endAt), 250);
		return;
	}
	freeNow(my);
}

function speakRaw(text) {
	const my = ++token;
	const u = new SpeechSynthesisUtterance(text);
	if (voice) {
		u.voice = voice;
		u.lang = voice.lang;
	} else {
		u.lang = "en-US";
	}
	u.rate = 1;
	u.pitch = 1;
	u.onend = () => freeNow(my);
	u.onerror = () => freeNow(my);
	busy = true;
	clearTimeout(watchdog);
	const estimate = 1500 + text.length * 120;
	watchdog = setTimeout(
		() => checkWatchdog(my, Date.now() + estimate),
		estimate,
	);
	if (text.trim() && onSpeak) onSpeak(text);
	speechSynthesis.speak(u);
}

// Stops anything being spoken right away and clears the busy flag, so the next line can start.
// The cancelled utterance's end event is ignored because its token is out of date.
export function cancelSpeech() {
	if (!supported) return;
	token++;
	busy = false;
	clearTimeout(watchdog);
	speechSynthesis.cancel();
}

// Call once from the Start tap. Browsers only allow speech after a user gesture.
export function unlockSpeech() {
	if (!supported || busy) return;
	speakRaw(" ");
}

// Speaks text if nothing is playing, and returns true if it started.
// Never cancels speech in progress, so sentences always finish.
export function speakText(text) {
	if (!supported || !text) return false;
	if (busy || speechSynthesis.speaking) return false;
	speakRaw(text);
	return true;
}

// Kept for the Start button's "Navigation started." message.
export function say(text) {
	return speakText(text);
}
