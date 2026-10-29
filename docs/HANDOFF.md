# NaViGuide: handoff notes

Last updated: 2026-10-24
Branch: `qwen-llm` (started from `moonshine-voice` at `948ec67`)

This file is the working memory for the project. Update it at the end of each session. Commit messages say what changed. This file says why, and what's next.

## Project scope (settled)

- NaViGuide is a student senior project: a PWA that gives spoken guidance about the ground and obstacles, from a phone camera, to visually impaired users.
- **Wayfaring, not wayfinding.** The app describes what's around the user. It does not give routes or directions. Route questions are out of scope.
- **Smartphone only.** No external devices. Mounting is a harness or chest mount.
- **Not for real navigation.** The disclaimer says so, and the app is only used in supervised testing for now.
- Supported test browsers: Chrome on Windows and Chrome on Android.
- Offline is the goal. Current state: the voice model is local. The answer model and the WebLLM library still load from the internet.
- Headphones are the recommended setup. Speaker sound can be picked up by the mic, and the app doesn't mute the mic.

## Architecture (where things live)

- `js/main.js`: startup, the camera loop, starting and stopping, and wiring the voice, alerts, and answers together.
- `js/worker.js` and `js/worker-core.js`: runs the vision models (segmentation, depth, semantic) off the main thread.
- `js/detect.js`: object detections, cleanup, and duplicate merging.
- `js/sem.js`: ground reading from the semantic model (surfaces, doors, stairs, walls).
- `js/navigation.js`: ranks what could be said, and decides the alert. This is where the priority rules live.
- `js/alerts.js`: the message queue. Keeps only the newest message. Handles the hold, the 3-second gap after navigation speech, the 8-second topic cooldown, and reminders.
- `js/speech.js`: all spoken output. Exposes `speakText`, `setOnFree`, `setOnSpeak`, and `cancelSpeech`.
- `js/voice.js`: Moonshine voice input. Handles commands, the question cue, the echo filter, and the question window.
- `js/intro.js`: four spoken screens: tap to continue, welcome, disclaimer, instructions. Listening stays paused until the instructions finish.
- `js/scene.js`: builds the scene snapshot (JSON) for each question.
- `js/llm.js` and `js/llm-worker.js`: the answer model (WebLLM, Qwen2.5-0.5B-Instruct).
- `js/config.js`: every threshold in one place.
- `sw.js`: offline caching. Bump `SHELL_VERSION` when app files change, and `ASSET_VERSION` when models or vendored runtime files change.

## Voice rules (settled)

- **Stop:** the words "stop" and "navigation," in any order, anywhere in a pickup. Works while the app is speaking. Checked before the echo filter.
- **Start:** the words "start" and "navigation," in any order. Only when the app is not running, and only after the intro's instructions finish.
- **Question cue:** any two of these groups in one pickup, in any order: "navi" (or "navy," "nabi," "navvy"), "have," "question."
- **Question flow:** cue opens the question. Navigation is held. The app says "Yes?", waits 1 second after speech, then opens a 6-second window. The next pickup is the question. If nothing is heard, the app says it didn't get that, and opens one more window. After the second miss, it apologizes and resumes navigation.
- **Echo filter:** a pickup is dropped if all its words match what the app just said, or if at least 80% of a 3+ word pickup matches. Applies to questions and cues.
- Commands are not gated on "navi." The cue and the stop and start rules each need only their words.

## Navigation speech rules (settled)

- One message is spoken per cycle. The highest-ranked message wins. Only the newest message waits.
- A 3-second gap after navigation speech, before the next navigation message. Safety messages skip the gap.
- The same subject is not repeated within 8 seconds. Information messages wait 3 seconds after the last one.
- A reminder repeats after 10 seconds if the situation continues.
- Navigation is held during a question and during the answer. Safety messages are not exempt from the hold.

## Answer rules (settled)

- The answer comes only from the scene snapshot, taken at the moment the question is heard.
- The snapshot is held in memory only until the answer is spoken. Nothing is stored. No camera images are included.
- Counts and yes/no facts are computed in code, so the model only reads them.
- Route and direction questions are refused as out of scope.
- The model's reply must be JSON with `answer`, `in_scope`, and `fields_used`. A reply that doesn't parse becomes the fallback message.
- Model: `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` through `@mlc-ai/web-llm@0.2.85`. Loads after the intro. Fallback to 1.5B if answers are unreliable.

## Open issues

- **Answers return "Sorry, I couldn't answer that."** Cause not yet confirmed. Next step: log the raw model output and any error, then test.
- **Scene JSON v2 is not built yet.** Planned: every detection keeps its real name, score, zone, distance, and approach. Ground includes per-zone surface detail. Alert decisions are included as facts. Possibly limit to the nearest N objects with a note about the rest.
- **First run is slow.** Models take a while to load on the first run. Works after that. Accepted for now.
- **Possible first-run mic dropouts on the phone.** Not confirmed. We can't check the phone console right now.
- **Speaker echo.** Not fully solved. Headphones are the recommended setup.
- **CDN dependencies.** WebLLM loads from a CDN, and the answer model downloads from the internet. Offline use needs the library vendored and the model cached.
- **Threaded WASM on GitHub Pages.** Cross-origin isolation headers come from `server.py` locally. GitHub Pages doesn't send them, so the threaded speech model may fail there. Not yet tested on the live site.
- **ScriptProcessor fallback.** The audio worklet file isn't in the library package, so the library falls back to the older audio method. Works, but runs on the main thread.
- **Stop and start announcements.** Announcements are worded so the app doesn't hear its own speech as commands. Watch for regressions.

## Test checklist

Laptop, with headphones:

- Cue: "Navi, I have a question," "have a question," and "navi question." Each should open the question.
- Question: "How many people are here?", "How many doors?", "Are stairs near?" Each should give the right answer.
- Out of scope: "How do I get to the stairs?" Should be refused.
- Stop mid-speech: "Navi, stop navigation" should stop right away.
- Start after stop: "Start navigation" in any order should start the app.
- Intro: nothing starts while the screens are speaking.

Phone, Chrome on Android:

- Same checks as the laptop, plus timing: time from question to spoken answer.
- First run versus second run.

## Pending decisions and tasks

1. Fix the answer failure: log the raw model output and errors.
2. Build the scene JSON v2 (see open issues). Decide how many objects to include.
3. Test the answer set on the laptop with saved snapshots.
4. Phone test of the answer flow and timing.
5. Merge `qwen-answers` into `moonshine-voice`, then into `main` once tested. Pages only serves `main`.
6. Mount decision: a chest mount or harness.
7. Professor document: supported browsers, the device decision, the offline caveat, and the safety disclaimer.
