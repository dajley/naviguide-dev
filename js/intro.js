// Opening sequence: tap to continue, then three spoken screens (welcome, disclaimer, instructions).
// Each screen is shown and spoken, then the next one starts. Listening opens after the last one.

const SCREENS = [
	{
		title: "Welcome to NaViGuide",
		body: "NaViGuide is a computer vision based navigation aid. It uses your device's camera to describe what is around you.",
	},
	{
		title: "Disclaimer",
		body: "NaViGuide is a student project. It is not an official navigation tool, it has not been tested or certified for safety, and it must not be relied on for real-life navigation. Instructions may lag by a few seconds.",
	},
	{
		title: "Instructions",
		body: "To start, say: 'Navi, start navigation.' To stop, say: 'Navi, stop navigation.' To ask a question, say: 'Navi, I have a question,' then wait for 'Yes' before you ask the question.",
	},
];
const PAUSE_MS = 1000; // quiet time between screens
const RESUME_DELAY_MS = 1500; // lets the last screen's speech clear before listening opens
const FADE_MS = 600;

const intro = document.getElementById("intro");
const begin = document.getElementById("begin");
const screen = document.getElementById("screen");
const screenTitle = document.getElementById("screen-title");
const screenText = document.getElementById("screen-text");
const main = document.querySelector("main");

// Speaks text, then calls done. A timed wait backs it up in case the browser
// never reports the end of the speech.
function speak(text, done) {
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		done();
	};

	if (!("speechSynthesis" in window)) {
		setTimeout(finish, 1500);
		return;
	}

	const u = new SpeechSynthesisUtterance(text);
	u.lang = "en-US";
	u.onend = finish;
	u.onerror = finish;
	speechSynthesis.speak(u);
	setTimeout(finish, 2000 + text.length * 120);
}

function openMain() {
	intro.classList.add("leaving");
	setTimeout(() => {
		intro.hidden = true;
		main.inert = false;
	}, FADE_MS);
}

// Shows one screen and speaks it, then moves on. After the last one, opens the main screen
// and calls onDone so listening can start.
function showScreen(i, onDone) {
	if (i >= SCREENS.length) {
		setTimeout(() => {
			openMain();
			onDone?.();
		}, RESUME_DELAY_MS);
		return;
	}
	const s = SCREENS[i];
	screenTitle.textContent = s.title;
	screenText.textContent = s.body;
	screen.hidden = false;
	speak(`${s.title}. ${s.body}`, () =>
		setTimeout(() => showScreen(i + 1, onDone), PAUSE_MS),
	);
}

// The first tap anywhere on the opening screen starts the screens.
export function startIntro(onDone) {
	begin.addEventListener(
		"click",
		() => {
			begin.hidden = true;
			showScreen(0, onDone);
		},
		{ once: true },
	);
}
