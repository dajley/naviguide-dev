// Labels a question's kind and picks its topic from the camera's list, using Qwen2.5 through WebLLM.
// The model never answers the question. Code writes the answer from the facts.
// The WebLLM library is vendored in js/vendor/webllm so the app works offline.
// It loads only when the model is first needed, so it doesn't slow down the voice startup.

const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

// The names change with the camera's view, so the prompt is built for each question.
function systemPrompt(names) {
	return `You label questions for a camera assistant. Do not answer the question.
Reply only with JSON: {"kind": "...", "topic": "..."}
kind is one of:
- count: how many things, or the number of things
- presence: is there a thing, or do you see a thing
- where: where a thing is
- distance: how far a thing is
- nearest: what is close or nearest to me
- route: how to get somewhere, or directions
topic is the thing asked about. If one name in this list means the same thing, use that name exactly: ${names.join(", ")}.
If none of the names fits, use the one word the user asked about, singular. Use null if there is none.`;
}

let engine = null;
let ready = false;

export function isReady() {
	return ready;
}

// Downloads and loads the model the first time. Later calls do nothing.
// The model weights are kept in the browser's cache, so after one online load the app works offline.
export async function loadAnswerModel(onProgress) {
	if (engine) return;
	const { CreateWebWorkerMLCEngine } = await import("./vendor/webllm/index.js");
	const worker = new Worker(new URL("./llm-worker.js", import.meta.url), {
		type: "module",
	});
	engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, {
		initProgressCallback: (p) => onProgress?.(p.text),
	});
	ready = true;
}

// Returns { kind, topic } from the model, or null if the reply can't be read.
export async function interpretQuestion(question, names = []) {
	if (!ready) return null;
	try {
		const reply = await engine.chat.completions.create({
			messages: [
				{ role: "system", content: systemPrompt(names) },
				{ role: "user", content: question },
			],
			temperature: 0,
			max_tokens: 60,
		});
		const content = reply.choices[0].message.content;
		console.log("label:", content);
		const start = content.indexOf("{");
		const end = content.lastIndexOf("}");
		if (start === -1 || end <= start) return null;
		const data = JSON.parse(content.slice(start, end + 1));
		return { kind: data.kind, topic: data.topic };
	} catch (err) {
		console.warn("label failed:", err);
		return null;
	}
}
