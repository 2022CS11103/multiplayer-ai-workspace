/** Intent router: classify a human turn before any agent acts. */

export type IntentKind =
  | "literal"
  | "save_finding"
  | "read_finding"
  | "save_decision"
  | "read_decision"
  | "test"
  | "inspect"
  | "write_code"
  | "review"
  | "research"
  | "ideas"
  | "testing_idle"
  | "none";

export type ClassifiedIntent = {
  kind: IntentKind;
  literal?: string;
};

export function stripAgentPrefix(text: string) {
  return text.replace(/^\s*(?:@)?(?:coding|testing|research|review)\s+agent:?\s*/i, "").trim();
}

/** True when `target` appears under do-not / don't / never / without. */
export function isNegated(text: string, target: RegExp) {
  const body = target.source;
  return new RegExp(String.raw`\b(?:do not|don't|dont|never|without)\b[\s\S]{0,96}?(?:${body})`, "i").test(text);
}

/** Drop "do not …" clauses so leftover text can be classified. */
export function withoutNegatedClauses(text: string) {
  return text
    .replace(/\b(?:do not|don't|dont|never)\b[^.!\n]{0,160}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLiteralReply(text: string): string | null {
  const stripped = stripAgentPrefix(text);
  const match = stripped.match(/\b(?:return|reply|output|respond) only\s*:\s*(.+)/i);
  if (!match?.[1]) return null;
  return match[1].trim().split(/\n/)[0].replace(/^["'`]+|["'`]+$/g, "").trim() || null;
}

export function forbidsModification(text: string) {
  return (
    /\bdo not modify\b/i.test(text) ||
    /\bdon't modify\b/i.test(text) ||
    /\bwithout modifying\b/i.test(text) ||
    /\bdo not (?:change|edit|write|patch|touch) (?:any )?(?:files?|code|source)\b/i.test(text)
  );
}

export function refusesSharedContext(text: string) {
  return (
    /\b(?:do not|don't|dont|never)\b.{0,40}\bshared context\b/i.test(text) ||
    /\bwithout (?:using )?shared context\b/i.test(text)
  );
}

export function refusesTesting(text: string) {
  return (
    /\bdo not (?:run|execute|use)?\s*(?:any\s+)?tests?\b/i.test(text) ||
    /\bdon't (?:run|execute)\s*(?:any\s+)?tests?\b/i.test(text) ||
    /\bdo not test\b/i.test(text) ||
    /\bdon't test\b/i.test(text) ||
    /\bwithout (?:running|executing) (?:any\s+)?tests?\b/i.test(text) ||
    /\bdo not execute\b.{0,40}\btests?\b/i.test(text) ||
    /\bno tests?\b/i.test(text)
  );
}

export function hasLabeledFinding(text: string) {
  return /(?:^|\n)\s*finding\s*:/i.test(stripAgentPrefix(text));
}

export function refusesFindingWrite(text: string) {
  if (hasLabeledFinding(text) && !/\bdo not create a finding\b/i.test(text) && !/\bdo not (?:create|save|pin|add|store)\b.{0,40}\bfindings?\b/i.test(text)) {
    return false;
  }
  return isNegated(text, /\bfindings?\b/) || /\bdo not (?:create|save|pin|add|store)\b.{0,40}\bfindings?\b/i.test(text);
}

export function wantsSharedMemory(text: string) {
  return /\b(use|follow|apply|respect|read|list|show|recall)\b.{0,60}\b(shared (?:context|decisions?|findings?)|pinned decisions?|latest finding)\b/i.test(
    text
  );
}

export function isMetaFindingInstruction(text: string) {
  const t = stripAgentPrefix(text).trim();
  if (/save the finding you just identified/i.test(t) && !hasLabeledFinding(t)) return true;
  if (/^(?:please )?save this finding\.?$/i.test(t)) return true;
  if (/^(?:do not|don't)\b/i.test(t) && t.length < 120 && !/\bint\(|truncat|silently\b/i.test(t)) return true;
  return false;
}

export function isSaveFindingRequest(text: string) {
  if (extractLiteralReply(text)) return false;
  if (/\bdo not create a finding\b/i.test(text) && !hasLabeledFinding(text)) return false;
  if (refusesFindingWrite(text) && !hasLabeledFinding(text)) return false;
  if (hasLabeledFinding(text)) return true;
  if (/\bcreate(?:\s+exactly one|\s+a|\s+one)?\s+findings?\b/i.test(text) && !/\bdo not create\b/i.test(text)) return true;
  if (/\bsave this finding\b/i.test(text) || /\bpin this finding\b/i.test(text)) return true;
  if (/\bsave the finding you just identified\b/i.test(text)) return true;
  if (/\binspect\b/i.test(text)) return false;
  if (/\b(save|pin)\b.{0,48}\b(?:this |the )?(?:shared )?(?:context )?findings?\b/i.test(text)) return true;
  return false;
}

export function isReadFindingRequest(text: string) {
  if (extractLiteralReply(text) || isSaveFindingRequest(text) || refusesSharedContext(text)) return false;
  const t = text.trim();
  return /\b(read|list|show|get|recall|what(?:'s| is))\b.{0,120}\b(latest finding|pinned findings?|shared (?:context )?findings?|current findings?)\b/i.test(
    t
  );
}

export function isSaveDecisionRequest(text: string) {
  if (isNegated(text, /\b(decision|constraint)s?\b/) || extractLiteralReply(text)) return false;
  const t = text.trim();
  return (
    /\b(save|pin|store|add|create)\b.{0,80}\b(decision|constraint)\b/i.test(t) ||
    /\bshared project decision\b/i.test(t) ||
    /\bsave this decision\b/i.test(t) ||
    /\bpin this\b.{0,40}\b(shared context|decision)\b/i.test(t)
  );
}

export function isReadDecisionRequest(text: string) {
  if (refusesSharedContext(text) || extractLiteralReply(text) || isSaveFindingRequest(text)) return false;
  const t = text.trim();
  return (
    /\b(read|list|show|get|recall|what(?:'s| is)|name)\b.{0,120}\b(pinned decisions?|shared (project )?decisions?|current (shared )?decisions?)\b/i.test(t)
  );
}

export function isInspectRequest(text: string) {
  if (extractLiteralReply(text)) return false;
  if (isReadDecisionRequest(text) || isReadFindingRequest(text)) return false;
  if (hasLabeledFinding(text) || isSaveFindingRequest(text)) return false;
  const t = stripAgentPrefix(text).toLowerCase();
  if (/\b(implement|write (me )?(a |the )?(function|code|file)|fix (the )?bug|patch src|change the implementation)\b/.test(t)) {
    return false;
  }
  if (/\binspect only\b/.test(t) || /^\s*inspect\b/.test(t)) return true;
  if (/\bwithout inspecting\b|\bdo not inspect\b|\bdon't inspect\b/.test(t)) return false;
  if (/\bsave (?:this |the )?finding\b/i.test(t)) return false;
  return /\b(inspect|explain what|what (this|the) .{0,80}does|concise summary|identify the functions|names of all functions|identify potential edge|do not (just )?restate|detailed review of|review of src|open and inspect)\b/.test(
    t
  );
}

export function isReadOnlyCodeTask(text: string) {
  if (extractLiteralReply(text)) return false;
  return isInspectRequest(text) || (refusesTesting(text) && /\b(implementation|hcf|gcd|lcm|src\/|calculator\.py|open and inspect)\b/i.test(text));
}

export function classifyIntent(text: string): ClassifiedIntent {
  if (isSaveFindingRequest(text)) return { kind: "save_finding" };
  const literal = extractLiteralReply(text);
  if (literal) return { kind: "literal", literal };
  if (isReadFindingRequest(text)) return { kind: "read_finding" };
  if (isSaveDecisionRequest(text)) return { kind: "save_decision" };
  if (isReadDecisionRequest(text)) return { kind: "read_decision" };
  if (isInspectRequest(text) || isReadOnlyCodeTask(text)) return { kind: "inspect" };
  if (isTestRequestLite(text)) return { kind: "test" };
  if (isAffirmativeWrite(text)) return { kind: "write_code" };
  if (refusesFindingWrite(text) && !hasLabeledFinding(text)) {
    return { kind: "literal", literal: "NO_FINDING_CREATED" };
  }
  if (forbidsModification(text) || refusesTesting(text)) {
    return { kind: "literal", literal: "OK. No files changed. No tests run." };
  }
  return { kind: "none" };
}

/** Lightweight test check used by classifyIntent to avoid importing tester. */
function isTestRequestLite(text: string) {
  const t = text.trim();
  if (refusesTesting(t) || extractLiteralReply(t) || isInspectRequest(t)) return false;
  if (isSaveFindingRequest(t) || isReadFindingRequest(t) || isSaveDecisionRequest(t) || isReadDecisionRequest(t)) return false;
  if (/\bdo not (?:run|execute)\b/i.test(t) && /\btests?\b/i.test(t)) return false;
  if (/\b(run tests?|test it|unit tests?|check (it|with examples|examples)|try examples)\b/i.test(t)) return true;
  if (/\b(run|execute)\b.{0,80}\b(tests?|cases?)\b/i.test(t) && !isNegated(t, /\b(tests?|cases?)\b/)) return true;
  if (/\bedge[- ]cases?\b/i.test(t) && /\b(test|run|execute)\b/i.test(t) && !refusesTesting(t)) return true;
  if (/\b(run exactly|execute only|only this (single )?test|new test suite)\b/i.test(t) && !refusesTesting(t)) return true;
  if (
    /\b(run|execute|test|output|pass)\b/i.test(t) &&
    /\b(?:hcf|gcd|lcm|add|divide|modulo|calculate|subtract|multiply)\s*\([^)]+\)/i.test(t)
  ) {
    return true;
  }
  if (
    /^\s*(?:@)?testing agent\b/i.test(t) &&
    /\b(?:hcf|gcd|lcm|add|divide|modulo|calculate|subtract|multiply)\s*\([^)]+\)/i.test(t)
  ) {
    return true;
  }
  return false;
}

function isAffirmativeWrite(text: string) {
  if (extractLiteralReply(text) || forbidsModification(text) || isInspectRequest(text)) return false;
  if (isSaveFindingRequest(text) || isSaveDecisionRequest(text) || isReadFindingRequest(text) || isReadDecisionRequest(text)) return false;
  const rest = withoutNegatedClauses(text);
  if (!rest) return false;
  return /\b(write|implement|code|program|function|solve|leetcode|python|javascript|\bjs\b|\bts\b|java|golang|\bcpp\b|c\+\+|go\b|\d\s*sum|two\s*sum|three\s*sum|fizz\s*buzz|palindrome|factorial|fibonacci|sort|binary search|hello world|calculator|modulo|lcm|hcf|gcd|new project|frontend|html|css|react|website|landing|ui|create)\b/i.test(
    rest
  );
}
