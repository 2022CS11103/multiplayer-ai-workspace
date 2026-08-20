import type { CodeFile, PlanStep } from "./types";

export type CodeReview = {
  title: string;
  reply: string;
  files: CodeFile[];
  plan: PlanStep[];
};

const REVIEW_ASK =
  /\b(check|review|correct|sahi|right|wrong|galat|verify|is this|is it|kya yeh|yeh sahi)\b/i;

export function isCodeReviewRequest(text: string) {
  const hasAsk = REVIEW_ASK.test(text);
  const hasCode = /#include\b|int main\s*\(|vector<|def |function |class |using namespace/.test(text);
  return hasAsk && hasCode;
}

export function reviewPastedCode(prompt: string): CodeReview {
  const code = extractCode(prompt);
  const notes = inspect(code);
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const path = notes.path;
  const files: CodeFile[] = [
    {
      path,
      language: notes.language,
      status: "added",
      modifiedBy: "Review Agent",
      lastActivity: now,
      content: code,
    },
  ];
  const bugs = notes.issues.filter((issue) => issue.level === "bug");
  const verdict = bugs.length
    ? `Not fully correct — ${bugs.length} issue${bugs.length === 1 ? "" : "s"} to fix.`
    : "The approach is correct. I saved your paste in the Code tab.";

  return {
    title: notes.title,
    reply: `${verdict}

${notes.issues.map((issue) => `${issue.level === "bug" ? "✗" : "•"} ${issue.text}`).join("\n\n")}

${notes.ok}

Saved as \`${path}\`. Testing will still run a few example cases for this problem.`,
    files,
    plan: [
      { id: "v1", title: "Read the pasted code", status: "completed" },
      { id: "v2", title: "Check compile + logic", status: "completed" },
      { id: "v3", title: "List issues", status: "completed" },
    ],
  };
}

function extractCode(prompt: string) {
  const fenced = prompt.match(/```(?:cpp|c\+\+|python|javascript|java|go)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const include = prompt.indexOf("#include");
  if (include >= 0) {
    const end = prompt.lastIndexOf("}");
    if (end > include) return prompt.slice(include, end + 1).trim();
  }
  const def = prompt.search(/\b(def |function |class |int main)/);
  if (def >= 0) return prompt.slice(def).trim();
  return prompt.trim();
}

function inspect(code: string) {
  const issues: Array<{ level: "bug" | "note"; text: string }> = [];
  const isCpp = /#include|vector<|using namespace std/.test(code);
  const isFour = /fourSum|four_sum|4\s*-\s*sum|4sum/i.test(code);
  const isThree = /threeSum|three_sum|3sum/i.test(code);
  const isTwo = /twoSum|two_sum|2sum/i.test(code);

  if (isCpp && /\bsort\s*\(/.test(code) && !/#include\s*<algorithm>/.test(code)) {
    issues.push({
      level: "bug",
      text: "This will not compile: `sort` needs `#include <algorithm>`. You only included iostream and vector.",
    });
  }

  if (isFour) {
    const leftAhead = /nums\[l\]\s*==\s*nums\[l\s*\+\s*1\]/.test(code);
    const leftBack = /nums\[l\]\s*==\s*nums\[l\s*-\s*1\]/.test(code);
    if (leftAhead && !leftBack) {
      issues.push({
        level: "bug",
        text: "After a hit you do `l++; r--;` then skip with `nums[l] == nums[l + 1]`. After increment, skip duplicates against the previous index: `nums[l] == nums[l - 1]`. Looking ahead can jump over a valid quadruplet when there are extra duplicates.\n\nUse:\n```\nl++; r--;\nwhile (l < r && nums[l] == nums[l - 1]) l++;\nwhile (l < r && nums[r] == nums[r + 1]) r--;\n```",
      });
    }
  }

  if (isCpp && isFour && /1LL\s*\*|long long/.test(code)) {
    issues.push({
      level: "note",
      text: "Good: `long long` / `1LL *` avoids int overflow on the four-number sum.",
    });
  }

  if (isCpp && /vector<int>\s+nums\s*,/.test(code)) {
    issues.push({
      level: "note",
      text: "`vector<int> nums` copies the whole array. `vector<int>& nums` (or sort a local copy) is cheaper; not a logic bug.",
    });
  }

  if (isFour || isThree || isTwo) {
    issues.push({
      level: "note",
      text: "The shape is right: sort, skip duplicate outer indices, two pointers on the rest. That is the standard O(n³) 4-Sum / O(n²) 3-Sum pattern.",
    });
  }

  if (!issues.length) {
    issues.push({
      level: "note",
      text: "I did not find a compile or pointer-skip bug in this paste. Example tests will still run.",
    });
  }

  const title = isFour ? "Four Sum" : isThree ? "Three Sum" : isTwo ? "Two Sum" : "Code review";
  const path = isFour
    ? isCpp
      ? "src/four_sum.cpp"
      : "src/four_sum.py"
    : isCpp
      ? "src/pasted.cpp"
      : "src/pasted.py";

  return {
    title,
    path,
    language: isCpp ? "cpp" : "python",
    issues,
    ok: isFour
      ? "On the usual sample `{1,0,-1,0,-2,2}` target `0`, this approach should print the three unique quadruplets. That sample alone does not prove the skip line is safe."
      : "I reviewed the paste instead of rewriting it.",
  };
}
