import { describe, it, expect } from "vitest";
import { readingPrompt, watcherPrompt } from "../src/prompts";
// Live 01-barking-labrador: two 0.2 s barks in a 10 s clip were reported
// unclear/none even with the WAV intact, because the prompt let sparse frames
// veto brief audio events and let an abstaining heuristic veto the audio.
const watcher = {
  trigger: "vocal_start",
  trigger_types: ["vocal_start", "state_change"],
  sound_scores: { dog: 0.8, bark: 0.6, howl: 0, whine: 0, growl: 0, yip: 0 },
  prev_state: "still",
  new_state: "vocalization:bark",
  time_in_prev_state_s: 5,
  yamnet: [{ label: "Bark", score: 0.6 }],
  motion: 0.05,
  observations: {
    vocal_type: "bark",
    bursts: 2,
    sustained_s: 0.5,
    activity: "vocalization",
  },
  centroid_shift: 0,
  bbox: null,
  dog_present: true,
  detector: "mediapipe",
} as any;
describe("vocal prompts do not let sparse frames veto brief barks", () => {
  it("watcher hint verifies vocal triggers primarily against audio", () => {
    const text = watcherPrompt(watcher);
    expect(text).toMatch(/primarily against the audio/i);
    expect(text).toMatch(/cannot veto/i);
  });
  it("reading prompt reports brief corroborated bursts with type and count", () => {
    const text = readingPrompt("es", {}, "live", undefined, watcher, "at_home");
    expect(text).toMatch(/brief.*burst/i);
    expect(text).toMatch(/do not default to unclear/i);
    expect(text).toMatch(/no transcribed human speech/i);
  });
  it("unclear heuristic hints do not veto judging the audio", () => {
    const text = readingPrompt("es", {}, "live", undefined, watcher, "at_home");
    expect(text).toMatch(/abstain/i);
    expect(text).toMatch(/judge the .* audio yourself/i);
  });
});
