import evidence from "../public/evidence.json";
export default evidence;
import { citationUrl as urlFor } from "../public/evidence-utils.js";
export const citationUrl = (id: string) => urlFor(id, evidence.citations);
