# Models used in NaViGuide

NaViGuide runs these AI models in the browser. The model files are in `models/`, and the code that runs them is in `vendor/`.

| Model                                                                  | Purpose                                                                          | Source                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- |
| **YOLO26n segmentation** (`models/yolo26n/yolo26n-seg.onnx`)           | Finds and outlines objects in the camera view, such as people, cars, and chairs. | [Ultralytics instance segmentation](https://docs.ultralytics.com/tasks/segment), exported to ONNX                                    |
| **YOLO26n semantic ADE20K** (`models/yolo26n/yolo26n-sem-ADE20K.onnx`) | Labels the ground, walls, doors, and stairs.                                     | [Ultralytics semantic segmentation](https://docs.ultralytics.com/tasks/semantic), exported to ONNX                                   |
| **YOLO26n depth** (`models/yolo26n/yolo26n-depth.onnx`)                | Estimates how far away things are.                                               | [Ultralytics depth estimation](https://docs.ultralytics.com/tasks/depth), exported to ONNX                                           |     |
| **Moonshine tiny** (`models/moonshine-tiny/`)                          | Turns spoken commands and questions into text.                                   | [onnx-community/moonshine-tiny-ONNX](https://huggingface.co/onnx-community/moonshine-tiny-ONNX) on Hugging Face                      |
| Silero VAD v5 (vendor/moonshine-tiny/silero_vad_v5.onnx)               | Detects when someone is speaking, so the app knows when to listen.               | Silero team, loaded by the Moonshine library through @ricky0123/vad-web                                                              |     |
| **all-MiniLM-L6-v2** (`models/minilm/`)                                | Matches unusual questions to the question types the app knows.                   | [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on Hugging Face, ONNX format |

The library files that run these models are in `vendor/`. They are copies of third-party code, and they keep their original notices.
