import type { Decision, Finding } from "./types";
import {
  isMetaFindingInstruction,
  isSaveDecisionRequest,
  isSaveFindingRequest,
  stripAgentPrefix,
} from "./intent";

export {
  isReadDecisionRequest,
  isReadFindingRequest,
  isSaveDecisionRequest,
  isSaveFindingRequest,
} from "./intent";

export function extractDecisionText(text: string): string | null {
  const stripped = stripAgentPrefix(text);

  const quoted = stripped.match(/[“"]([^”"]{8,})[”"]/);
  if (quoted?.[1]) return tidyDecision(quoted[1]);

  const that = stripped.match(/\bdecision\s+that\s+(.+?)(?:\.?\s*(?:save|pin)\b|$)/i);
  if (that?.[1]) return tidyDecision(that[1]);

  const labeled = stripped.match(/\b(?:decision|constraint)\s*:\s*([\s\S]+)$/i);
  if (labeled?.[1]) {
    return tidyDecision(labeled[1].replace(/\s*save this decision.*$/i, ""));
  }

  if (isSaveDecisionRequest(stripped)) {
    const cleaned = stripped
      .replace(/\bcreate a shared project decision(?:\s+that)?\b/gi, " ")
      .replace(/\bsave this decision(?:\s+to(?:\s+the)?\s+shared context)?\b/gi, " ")
      .replace(/\bpin this(?: decision)?(?:\s+to(?:\s+the)?\s+shared context)?\b/gi, " ")
      .replace(/\bto the shared context\b/gi, " ")
      .replace(/\bdo not (?:inspect|modify).*$/gi, " ");
    const candidate = tidyDecision(cleaned);
    if (candidate.length >= 12) return candidate;
  }

  if (/^(we are|we're|decision:|decide:|constraint:|target:)/i.test(stripped) && stripped.length < 280) {
    return tidyDecision(stripped.replace(/^(decision:|decide:|constraint:|target:)\s*/i, ""));
  }
  if (/\bfocus on\b/i.test(stripped) && stripped.length < 200) return tidyDecision(stripped);
  return null;
}

export function formatDecisionList(decisions: Decision[]) {
  if (!decisions.length) {
    return "No pinned decisions in Shared Context yet. Pin one in the Decisions rail, or say “save this decision: …”.";
  }
  if (decisions.length === 1) {
    return `Shared decision:\n"${decisions[0].text}"`;
  }
  return `Shared decisions:\n${decisions.map((item, index) => `${index + 1}. "${item.text}"`).join("\n")}`;
}

export function formatDecisionsInForce(decisions: Decision[]) {
  if (!decisions.length) return "";
  return `Shared decisions in force:\n${decisions.map((item) => `• ${item.text}`).join("\n")}\n\n`;
}

export function extractFindingText(text: string): string | null {
  const stripped = stripAgentPrefix(text);
  const labeled = stripped.match(/(?:^|\n)\s*finding\s*:\s*(.+)/i);
  if (labeled?.[1]) {
    let claim = tidyDecision(labeled[1].split(/\n/)[0].replace(/\bfunction\s*:\s*.*$/i, ""));
    const fn = stripped.match(/(?:^|\n)\s*function\s*:\s*([a-zA-Z_]\w*)/i);
    if (fn?.[1] && claim && !new RegExp(String.raw`\b${fn[1]}\s*\(`, "i").test(claim)) {
      claim = `${fn[1]}(): ${claim}`;
    }
    if (claim.length >= 8 && !isMetaFindingInstruction(claim)) return claim;
  }

  const afterSave = stripped.match(
    /\b(?:save|pin|create)(?: this| the| exactly one)? finding(?: you just identified)?\s*[:\-]\s*(.+)/i
  );
  if (afterSave?.[1]) {
    const claim = tidyDecision(afterSave[1].split(/\n/)[0].replace(/\bdo not (?:modify|test|create).*$/i, ""));
    if (claim.length >= 12 && !isMetaFindingInstruction(claim)) return claim;
  }

  const quoted = stripped.match(/[“"]([^”"]{8,})[”"]/);
  if (quoted?.[1] && isSaveFindingRequest(stripped)) {
    const claim = tidyDecision(quoted[1]);
    if (claim && !isMetaFindingInstruction(claim)) return claim;
  }

  return null;
}

export function formatFindingList(findings: Finding[], latestOnly = false) {
  if (!findings.length) {
    return "No findings in Shared Context yet. Pin one with `Finding: …`.";
  }
  const items = latestOnly ? findings.slice(-1) : findings;
  if (items.length === 1) {
    return `Shared finding:\n"${items[0].claim}"`;
  }
  return `Shared findings:\n${items.map((item, index) => `${index + 1}. "${item.claim}"`).join("\n")}`;
}

export function formatFindingsInForce(findings: Finding[]) {
  if (!findings.length) return "";
  return `Shared findings in force:\n${findings.map((item) => `• ${item.claim}`).join("\n")}\n\n`;
}

export function formatMemoryPrefix(decisions: Decision[], findings: Finding[]) {
  return `${formatDecisionsInForce(decisions)}${formatFindingsInForce(findings)}`;
}

function tidyDecision(value: string) {
  return value
    .replace(/^[\s.:;,-]+/, "")
    .replace(/[\s.:;,-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
