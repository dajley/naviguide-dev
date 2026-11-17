# NaViGuide

**NaViGuide** is a multi-model computer vision-based assistive navigation system for blind and low-vision people. It uses a smartphone's camera to tell you what is around you and whether the way ahead is clear through spoken alerts. You can also ask it spoken questions, such as "what is on my left?"

NaViGuide describes what is nearby in both indoor and outdoor environments. It does not give step-by-step route directions.

- **Works in the browser.** It's a Progressive Web App, so there's nothing to install, and it works offline after the first load.
- **Runs on your device.** Camera frames are processed on your device. No video is sent to a server.
- **Finds and locates.** Three YOLO26n models detect obstacles, estimate their distance, and identify walkable ground and features that matter for moving safely, such as walls, doors, and stairs.
- **Listens.** Moonshine tiny recognizes speech, so you can start and stop the app and ask questions by voice.

> **Student project.** Student project. NaViGuide is a senior project. It is not an official navigation tool and should not be relied on as a mobility aid alone. It has been tested in Chrome on a laptop and an Android phone, but not yet with blind or low-vision users, and its distance thresholds are not calibrated.

**Live app:** https://dajley.github.io/naviguide-dev/

## Run It Locally

1. Clone the repo:
   ```bash
   git clone https://github.com/dajley/naviguide-dev.git
   cd naviguide-dev
   ```
2. Start a local web server in the project folder:
   ```bash
   python3 -m http.server 8000
   ```
3. Open http://localhost:8000 in Chrome and allow camera and microphone access.

Opening `index.html` directly won't work. The app needs a web server or HTTPS.

## Using the App

- To start, say **"Navi, start navigation"** or press **Start**. To stop, say **"Navi, stop navigation"** or press **Stop**.
- To ask a question, say **"Navi, I have a question,"** wait for "Yes," then ask.
- Tap to continue through the intro, or press **Skip intro**.

## Documentation

- [docs/OVERVIEW.md](docs/OVERVIEW.md): how the app works
- [docs/MODELS.md](docs/MODELS.md): the AI models and what each one does

## Project Files

- `index.html`: the page
- `css/`: styles
- `js/`: the app code
- `models/`, `vendor/`: AI models and third-party libraries
- `icons/`: app icons
- `sw.js`: offline support
- `manifest.webmanifest`: app install settings

## Publications

Draft paper: _NaViGuide: A Multi-Model Computer Vision-Based Assistive Navigation System for Blind and Low Vision People._ [Status, venue, and link to be added.]

## Authors

- Dajanique Leysath ([@dajley](https://github.com/dajley))
- Nadia Ihsan Omer ([@nadia-io](https://github.com/nadia-io))

Senior Project, Computer Science, Fall 2026, South Carolina State University
