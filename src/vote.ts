// Port of bench.mjs vote(): three independent descriptions, never an AI judge.
// Ties, unsupported values and free-text disagreement resolve to unclear.
import {
  emptyDescriptors,
  type Descriptors,
  type Descriptor,
} from "./descriptors";
import { observableName } from "../public/evidence-utils.js";
function majority<T>(values: T[]): T | undefined {
  return values.find(
    (value) => values.filter((other) => other === value).length >= 2,
  );
}
export function vote(
  descriptions: Descriptors[],
  lang: "en" | "es" = "en",
): Descriptors {
  if (descriptions.length !== 3)
    throw new Error("Voting requires three descriptors");
  const unknown =
    lang === "es"
      ? "Sin mayoría entre tres observaciones."
      : "No majority among three observations.";
  const out = emptyDescriptors(unknown);
  for (const key of Object.keys(out) as (keyof Descriptors)[]) {
    if (key === "vocalization") {
      const voices = descriptions.map((d) => d.vocalization);
      const type = majority(
        voices.map((v) => (v.seen === "yes" ? v.type : "none")),
      );
      if (!type || type === "unclear") continue;
      if (type === "none") {
        const seen = majority(voices.map((v) => v.seen));
        out.vocalization.seen = seen === "no" ? "no" : "unclear";
        out.vocalization.type = seen === "no" ? "none" : "unclear";
        continue;
      }
      const matching = voices.filter(
        (v) => v.seen === "yes" && v.type === type,
      );
      out.vocalization = {
        ...out.vocalization,
        seen: "yes",
        type,
        evidence: `${lang === "es" ? "Vocalización por mayoría" : "Majority vocalization"}: ${observableName(type, lang)}`,
      };
      for (const name of ["count", "bursts", "sustained_seconds"] as const)
        out.vocalization[name] = majority(matching.map((v) => v[name])) ?? 0;
      for (const name of [
        "pitch_relative",
        "harshness",
        "repetition",
        "modulation",
      ] as const)
        out.vocalization[name] =
          majority(matching.map((v) => v[name])) ?? "unknown";
      continue;
    }
    if (key === "scene_notes") {
      const evidence = majority(
        descriptions.map((d) =>
          d.scene_notes.seen === "yes" ? d.scene_notes.evidence : "",
        ),
      );
      if (evidence) out.scene_notes = { seen: "yes", evidence };
      else if (majority(descriptions.map((d) => d.scene_notes.seen)) === "no")
        out.scene_notes.seen = "no";
      continue;
    }
    const fields = descriptions.map((d) => d[key] as Descriptor);
    const yes = fields.filter((field) => field.seen === "yes");
    const values = [...new Set(yes.flatMap((field) => field.values))].filter(
      (value) =>
        yes.filter((field) => field.values.includes(value)).length >= 2,
    );
    if (yes.length >= 2 && values.length)
      out[key] = {
        seen: "yes",
        values,
        evidence: values
          .map((value) => observableName(value, lang))
          .join(" · "),
      };
    else
      out[key] = {
        seen:
          majority(fields.map((field) => field.seen)) === "no"
            ? "no"
            : "unclear",
        values: [],
        evidence: unknown,
      };
  }
  return out;
}
