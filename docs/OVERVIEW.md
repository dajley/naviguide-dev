# How NaViGuide Works

1. **`index.html`** loads the page and starts `js/main.js`, which runs the app.
2. **`js/camera.js`** gets frames from the camera. Each frame goes to a background worker (`js/worker.js`, `js/worker-core.js`).
3. The worker runs three AI models:
   - `detect.js` finds objects.
   - `depth.js` estimates how far away they are.
   - `sem.js` reads the ground, walls, doors, and stairs.
4. **`js/navigation.js`** picks the most important warning for each frame.
5. **`js/alerts.js`** decides when to speak it, and **`js/speech.js`** says it aloud.
6. **`js/voice.js`** listens for commands and questions. **`js/answers.js`** answers questions using the scene the camera sees. **`js/embed.js`** helps match questions with unusual wording.
7. **`js/overlay.js`** draws highlights on screen, for testers and sighted helpers.
8. **`js/config.js`** holds the settings you can tune, such as distances and timing.
9. **`js/intro.js`** plays the opening screens.

Every JavaScript file has a short comment at the top that says what it does.
