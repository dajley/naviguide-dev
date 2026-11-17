# Models Used in NaViGuide

NaViGuide runs these AI models in the browser. The model files are in `models/`, and the code that runs them is in `vendor/`.

## Instance Segmentation and Object Detection

**YOLO26n segmentation** (`models/yolo26n/yolo26n-seg.onnx`)

- **Purpose:** finds and outlines objects in the camera view, such as people, cars, and chairs.
- **Source:** [Ultralytics instance segmentation](https://docs.ultralytics.com/tasks/segment), exported to ONNX.

## Semantic Segmentation

**YOLO26n semantic ADE20K** (`models/yolo26n/yolo26n-sem-ADE20K.onnx`)

- **Purpose:** labels the ground, walls, doors, and stairs.
- **Source:** [Ultralytics semantic segmentation](https://docs.ultralytics.com/tasks/semantic), exported to ONNX.

## Monocular Depth Estimation

**YOLO26n depth** (`models/yolo26n/yolo26n-depth.onnx`)

- **Purpose:** estimates how far away things are.
- **Source:** [Ultralytics depth estimation](https://docs.ultralytics.com/tasks/depth), exported to ONNX.

## Speech

**Moonshine tiny** (`models/moonshine-tiny/`)

- **Purpose:** turns spoken commands and questions into text.
- **Source:** [onnx-community/moonshine-tiny-ONNX](https://huggingface.co/onnx-community/moonshine-tiny-ONNX) on Hugging Face.

**Silero VAD v5** (`vendor/moonshine-tiny/silero_vad_v5.onnx`)

- **Purpose:** detects when someone is speaking, so the app knows when to listen.
- **Source:** Silero team, loaded by the Moonshine library through `@ricky0123/vad-web`.

## Question matching

**all-MiniLM-L6-v2** (`models/minilm/`)

- **Purpose:** matches unusual questions to the question types the app knows.
- **Source:** [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on Hugging Face, ONNX format.

---

The library files that run these models are in `vendor/`. They are copies of third-party code, and they keep their original notices.
