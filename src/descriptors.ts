import { object, str } from "./schema";
const seen = { type: "string", enum: ["yes", "no", "unclear"] };
const descriptor = (values: string[]) =>
  object({
    seen,
    values: {
      type: "array",
      items: { type: "string", enum: values },
      maxItems: 8,
    },
    evidence: str,
  });
export const descriptorSchema = object({
  posture: descriptor([
    "neutral",
    "lowered",
    "very_low",
    "hunched",
    "head_lowered",
  ]),
  tail: descriptor(["wagging", "still", "tucked", "raised"]),
  ears: descriptor(["pinned_back", "adductor", "flattener", "neutral"]),
  mouth: descriptor([
    "lip_lick",
    "nose_lick",
    "yawn",
    "pant",
    "lips_part",
    "jaw_drop",
  ]),
  gaze: descriptor(["averted", "whale_eye", "blink", "toward_partner"]),
  body_shake: descriptor(["shake_off"]),
  play_bow: descriptor(["forelimbs_lowered_rear_raised"]),
  pain_signs: descriptor([
    "limp",
    "stiffness",
    "reluctance_to_move",
    "lick_area",
    "squinted_eyes",
  ]),
  interaction: descriptor([
    "other_dog",
    "person",
    "touch",
    "vocalize_on_touch",
    "interacting",
  ]),
  activity: descriptor(["still", "active", "restless", "pacing"]),
  // Observable actions only (what the dog is doing); never mapped to an emotion.
  behavior: descriptor([
    "lying_down",
    "eyes_closed",
    "sitting",
    "standing",
    "walking",
    "running",
    "eating",
    "chewing_object",
    "drinking",
    "sniffing",
    "digging",
    "chasing_object",
    "fixed_stare",
  ]),
  scene: descriptor([
    "sudden_stimulus",
    "external_stimulus",
    "reward_visible",
    "reward_withheld",
    "handling",
    "exit_scratching",
    "exit_destruction",
    "elimination",
    "hypersalivation",
    "heat_or_exercise",
    "trembling",
  ]),
  scene_notes: object({ seen, evidence: str }),
  vocalization: object({
    seen,
    evidence: str,
    type: {
      type: "string",
      enum: ["bark", "howl", "whine", "growl", "none", "unclear"],
    },
    count: { type: "integer", minimum: 0, maximum: 10000 },
    bursts: { type: "integer", minimum: 0, maximum: 10000 },
    sustained_seconds: { type: "number", minimum: 0, maximum: 30 },
    pitch_relative: {
      type: "string",
      enum: ["lower", "usual", "higher", "unknown"],
    },
    harshness: { type: "string", enum: ["harsh", "tonal", "unknown"] },
    repetition: {
      type: "string",
      enum: ["rapid", "long_intervals", "unknown"],
    },
    modulation: { type: "string", enum: ["modulated", "unknown"] },
  }),
});
export type Seen = "yes" | "no" | "unclear";
export type Descriptor = { seen: Seen; values: string[]; evidence: string };
export type Descriptors = Record<
  | "posture"
  | "tail"
  | "ears"
  | "mouth"
  | "gaze"
  | "body_shake"
  | "play_bow"
  | "pain_signs"
  | "interaction"
  | "activity"
  | "behavior"
  | "scene",
  Descriptor
> & {
  scene_notes: { seen: Seen; evidence: string };
  vocalization: {
    seen: Seen;
    evidence: string;
    type: string;
    count: number;
    bursts: number;
    sustained_seconds: number;
    pitch_relative: string;
    harshness: string;
    repetition: string;
    modulation: string;
  };
};
export function emptyDescriptors(text: string): Descriptors {
  const entry = (): Descriptor => ({
    seen: "unclear",
    values: [],
    evidence: text,
  });
  return {
    posture: entry(),
    tail: entry(),
    ears: entry(),
    mouth: entry(),
    gaze: entry(),
    body_shake: entry(),
    play_bow: entry(),
    pain_signs: entry(),
    interaction: entry(),
    activity: entry(),
    behavior: entry(),
    scene: entry(),
    scene_notes: { seen: "unclear", evidence: text },
    vocalization: {
      seen: "unclear",
      evidence: text,
      type: "unclear",
      count: 0,
      bursts: 0,
      sustained_seconds: 0,
      pitch_relative: "unknown",
      harshness: "unknown",
      repetition: "unknown",
      modulation: "unknown",
    },
  };
}
