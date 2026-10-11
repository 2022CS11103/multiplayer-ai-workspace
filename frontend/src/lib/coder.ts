import { detectDomain, isFrontendRequest } from "./domain";
import {
  classifyIntent,
  forbidsModification,
  isInspectRequest,
  isReadDecisionRequest,
  isReadFindingRequest,
  isSaveDecisionRequest,
  isSaveFindingRequest,
  refusesTesting,
  withoutNegatedClauses,
} from "./intent";
import type { CodeFile, PlanStep } from "./types";

export { isInspectRequest } from "./intent";

export type CodingWork = {
  title: string;
  reply: string;
  files: CodeFile[];
  plan: PlanStep[];
};

type Lang = "python" | "javascript" | "cpp" | "java" | "go";

type LangInfo = {
  id: Lang;
  ext: string;
  fence: string;
  label: string;
};

export type CodingProblem = "two-sum" | "three-sum" | "four-sum" | "fizzbuzz" | "palindrome" | "fibonacci" | "factorial" | "hello" | "calculator";
export type CodingVariant = "hash" | "brute" | "two-pointer";
export type CodingContext = {
  language?: Lang;
  problem?: CodingProblem;
  variant?: CodingVariant;
  source?: string;
};

const CODE_REQUEST =
  /\b(write|implement|create|code|program|function|solve|leetcode|python|javascript|\bjs\b|\bts\b|java|golang|\bcpp\b|c\+\+|go\b|\d\s*sum|two\s*sum|three\s*sum|fizz\s*buzz|palindrome|factorial|fibonacci|sort|binary search|hello world|calculator|modulo|lcm|hcf|gcd|new project|frontend|html|css|react|website|landing|ui)\b/i;

const FOLLOW_UP =
  /another|other|algo|algorithm|method|approach|brute|instead|same|sorry|do it|usko|ab|yeh|wahi|also|too\b|as well|include|support|feature/i;

const PROJECT_TWEAK =
  /\b(add|include|support|also|modulo|\bmod\b|remainder|power|sqrt|lcm|hcf|gcd|fun(ction)?|button|dark mode|save)\b/i;

const NEW_PROJECT =
  /\b(new project|start a new|start new|building a |build a |i want to build|want to build|let'?s build|lets build|now we start|fresh project)\b/i;

export function isNewProject(text: string) {
  return NEW_PROJECT.test(text);
}


export function isWriteCodeRequest(text: string) {
  return classifyIntent(text).kind === "write_code";
}

export function isCodeRequest(text: string) {
  if (forbidsModification(text) || classifyIntent(text).kind === "literal") return false;
  const rest = withoutNegatedClauses(text);
  return CODE_REQUEST.test(rest) || /\d\s*sum/i.test(rest) || isNewProject(text);
}

export function isProjectFollowUp(text: string) {
  return PROJECT_TWEAK.test(withoutNegatedClauses(text)) && !isNewProject(text);
}

export function isCodingFollowUp(text: string) {
  const intent = classifyIntent(text);
  if (intent.kind !== "write_code" && intent.kind !== "none") return false;
  if (forbidsModification(text) || isNewProject(text)) return false;
  if (isInspectRequest(text) || isSaveDecisionRequest(text) || isReadDecisionRequest(text) || isSaveFindingRequest(text) || isReadFindingRequest(text)) return false;
  if (/^\s*(?:@)?testing agent\b/i.test(text) || /\b@testing agent\b/i.test(text)) return false;
  const rest = withoutNegatedClauses(text);
  return FOLLOW_UP.test(rest) || isProjectFollowUp(text) || isWriteCodeRequest(text);
}

function pickInspectFile(files: CodeFile[], prompt: string) {
  const codeFiles = files.filter((file) => !file.path.startsWith("tests/"));
  const mentioned = prompt.match(/([\w./-]+\.(?:py|js|ts|tsx|jsx|java|go|cpp))/i)?.[1];
  if (mentioned) {
    const needle = mentioned.replace(/\\/g, "/").toLowerCase();
    const hit = codeFiles.find((file) => {
      const path = file.path.replace(/\\/g, "/").toLowerCase();
      return path === needle || path.endsWith(`/${needle}`) || path.endsWith(needle);
    });
    if (hit) return hit;
  }
  return codeFiles.find((file) => /calculator/.test(file.path)) ?? codeFiles[0];
}

function functionNames(content: string) {
  const py = [...content.matchAll(/^\s*def ([a-zA-Z_]\w*)\s*\(/gm)].map((match) => match[1]);
  const js = [...content.matchAll(/^\s*function ([a-zA-Z_]\w*)\s*\(/gm)].map((match) => match[1]);
  return [...new Set([...py, ...js].filter((name) => name !== "eval_node"))];
}

function extractFunction(content: string, name: string) {
  const start = content.search(new RegExp(String.raw`^(?:def|function) ${name}\s*\(`, "m"));
  if (start < 0) return "";
  const rest = content.slice(start);
  const next = rest.slice(1).search(/^(?:def|function) /m);
  return (next < 0 ? rest : rest.slice(0, next + 1)).trim();
}

export function summarizeExistingCode(files: CodeFile[], prompt: string): { title: string; reply: string; plan: PlanStep[] } {
  const main = pickInspectFile(files, prompt);
  if (!main) {
    return {
      title: "Inspect",
      reply: "No source files in this room yet. I did not create or modify anything.",
      plan: [{ id: "k1", title: "Inspect current files", status: "completed" }],
    };
  }
  const names = functionNames(main.content);
  const namesOnly = /\bnames of all functions|identify the functions|list (?:the )?functions|return the names\b/i.test(prompt);
  const focus = prompt.match(/\b(hcf|gcd|lcm|add|subtract|multiply|divide|modulo|calculate)\s*\(\)/i)?.[1]?.toLowerCase();
  const noTests = refusesTesting(prompt) || /\bdo not (?:modify|test)\b/i.test(prompt);

  if (namesOnly) {
    return {
      title: `Inspect ${main.path}`,
      reply: `Functions in ${main.path}: ${names.length ? names.join(", ") : "(none found)"}.

I only inspected this file. I did not modify anything, did not run tests, and did not write to Shared Context.`,
      plan: [
        { id: "k1", title: `Open ${main.path}`, status: "completed" },
        { id: "k2", title: "List function names", status: "completed" },
        { id: "k3", title: "Leave source unchanged", status: "completed" },
      ],
    };
  }

  if (focus) {
    const body = extractFunction(main.content, focus);
    const notes: string[] = [];
    if (/abs\(\s*int\(/.test(body) || /int\(/.test(body)) {
      notes.push(`${focus}() uses int(), which silently truncates non-integer inputs (e.g. 3.9 → 3).`);
    }
    if (/abs\(/.test(body)) notes.push(`${focus}() takes abs(), so sign is discarded.`);
    return {
      title: `Inspect ${focus}() in ${main.path}`,
      reply: `Inspected only ${focus}() in ${main.path}. I did not modify files${noTests ? " and I did not execute any tests" : ""}.

${body ? `Current implementation:\n\`\`\`python\n${body}\n\`\`\`` : `${focus}() is referenced but I could not extract a definition.`}
${notes.length ? `\nPotential issue:\n${notes.map((item) => `• ${item}`).join("\n")}` : ""}`,
      plan: [
        { id: "k1", title: `Inspect ${focus}()`, status: "completed" },
        { id: "k2", title: "Do not execute tests", status: noTests ? "completed" : "pending" },
        { id: "k3", title: "Leave source unchanged", status: "completed" },
      ],
    };
  }

  const watches: string[] = [];
  if (/if b == 0/.test(main.content)) watches.push("divide / modulo by zero raise ValueError.");
  if (/abs\(int\(/.test(main.content)) watches.push("hcf/gcd coerce with abs(int(...)), so negatives become positive and non-integers are truncated.");
  if (/if a == 0 or b == 0/.test(main.content)) watches.push("lcm returns 0 if either argument is 0.");
  if (/ast\.parse/.test(main.content)) {
    watches.push("calculate() uses ast.parse — empty or malformed strings raise SyntaxError; `**` is not in the operator map.");
  }
  const edge =
    /edge/.test(prompt.toLowerCase()) && !noTests
      ? "\n\nPotential edge cases worth executing next: divide(5,0), modulo(5,0), hcf(-12,18), hcf(0,5), lcm(-4,6), calculate(\"\"), calculate(\"2 +\"), calculate(\"2 ** 3\"), calculate(\"-5 + 2\"), nested parentheses."
      : "";
  return {
    title: `Inspect ${main.path}`,
    reply: `${main.path} currently defines ${names.length ? names.join(", ") : "the saved source"}.

I inspected the files. I did not modify anything and I am not dumping the source here — open the **Code** tab for the full file.
${watches.length ? `\nThings to watch:\n${watches.map((item) => `• ${item}`).join("\n")}` : ""}${edge}`,
    plan: [
      { id: "k1", title: "Inspect current files", status: "completed" },
      { id: "k2", title: "Summarize without rewriting", status: "completed" },
      { id: "k3", title: "Leave source unchanged", status: "completed" },
    ],
  };
}

export function shouldStartNewRoom(prompt: string, ctx: CodingContext, files: { path?: string }[] = []) {
  if (isNewProject(prompt)) return true;
  const next = detectProblem(prompt.toLowerCase());
  if (next && ctx.problem && next !== ctx.problem) return true;
  const nextDomain = detectDomain(prompt, []);
  const currentDomain = detectDomain(ctx.problem ?? "", files);
  if (isFrontendRequest(prompt) && currentDomain === "dsa") return true;
  if (nextDomain === "dsa" && currentDomain === "frontend") return true;
  return false;
}

export function contextFromFiles(files: { path: string; content: string }[], task = ""): CodingContext {
  const blob = `${task} ${files.map((file) => `${file.path}\n${file.content}`).join("\n")}`;
  const language = inferLanguageFromBlob(blob);
  const problem = detectProblem(blob.toLowerCase()) ?? detectProblem(task.toLowerCase());
  const variant = inferVariant(blob);
  return { language: language?.id, problem, variant, source: blob };
}

export function generateCodingWork(prompt: string, ctx: CodingContext = {}): CodingWork {
  const asked = prompt.toLowerCase();
  const source = ctx.source ?? "";
  const domain = detectDomain(asked);
  const keepCalc = ctx.problem === "calculator" || looksLikeCalculator(source);
  const wantsCalcOps = /hcf|gcd|lcm|\bmod(ulo)?\b|remainder/.test(asked);
  const fresh = isNewProject(asked) || Boolean(detectProblem(asked)) || (domain === "frontend" && !keepCalc);
  const lang =
    domain === "frontend" && !keepCalc
      ? { id: "javascript" as const, ext: "html", fence: "html", label: "HTML" }
      : detectLanguage(asked) ?? (fresh ? langFromId("python") : langFromId(ctx.language));
  const problem =
    detectProblem(asked) ??
    (fresh ? undefined : ctx.problem) ??
    (keepCalc || (wantsCalcOps && !ctx.problem) ? "calculator" : undefined);
  const wantsOther = /another|other|algo|algorithm|method|approach|brute|instead/.test(asked);
  const variant = wantsOther ? nextVariant(problem, ctx.variant) : detectProblem(asked) ? defaultVariant(problem) : ctx.variant ?? defaultVariant(problem);
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const spec =
    domain === "frontend" && !keepCalc ? frontendPage(asked) : pickSpec(problem, lang, variant, asked, source);

  const files: CodeFile[] = spec.files.map((file) => ({
    ...file,
    status: "added" as const,
    modifiedBy: "Coding Agent",
    lastActivity: now,
  }));

  const main = files[0];
  const reply = `${spec.blurb}

Saved as \`${main.path}\` (${lang.label}). Open the **Code** tab.

\`\`\`${lang.fence}
${main.content}
\`\`\``;

  return {
    title: spec.title,
    reply,
    files,
    plan: [
      { id: "k1", title: "Understand the request", status: "completed" },
      { id: "k2", title: `Write ${spec.title} in ${lang.label}`, status: "completed" },
      { id: "k3", title: "Add tests", status: files.length > 1 ? "completed" : "pending" },
      { id: "k4", title: "Run / refine", status: "pending" },
    ],
  };
}

function langFromId(id?: Lang): LangInfo {
  if (id === "cpp") return { id: "cpp", ext: "cpp", fence: "cpp", label: "C++" };
  if (id === "java") return { id: "java", ext: "java", fence: "java", label: "Java" };
  if (id === "go") return { id: "go", ext: "go", fence: "go", label: "Go" };
  if (id === "javascript") return { id: "javascript", ext: "js", fence: "javascript", label: "JavaScript" };
  return { id: "python", ext: "py", fence: "python", label: "Python" };
}

function detectLanguage(lower: string): LangInfo | undefined {
  if (/\bc\+\+|cpp|cplusplus|c plus plus\b/.test(lower)) return langFromId("cpp");
  if (/\bjava\b/.test(lower)) return langFromId("java");
  if (/\bgolang\b|\bgo\b/.test(lower)) return langFromId("go");
  if (/\btypescript\b|\bts\b/.test(lower)) return { id: "javascript", ext: "ts", fence: "typescript", label: "TypeScript" };
  if (/\bjavascript\b|\bnode\b|\bjs\b/.test(lower)) return langFromId("javascript");
  if (/\bpython\b|\.py\b/.test(lower)) return langFromId("python");
  return undefined;
}

function inferLanguageFromBlob(blob: string): LangInfo | undefined {
  if (/\.cpp\b|#include|unordered_map|vector</.test(blob)) return langFromId("cpp");
  if (/\.java\b|public class /.test(blob)) return langFromId("java");
  if (/\.go\b|package main/.test(blob)) return langFromId("go");
  if (/\.js\b|\.ts\b|function /.test(blob) && /const |console\.log/.test(blob)) return langFromId("javascript");
  if (/\.py\b|def /.test(blob)) return langFromId("python");
  return detectLanguage(blob.toLowerCase());
}

function detectProblem(lower: string): CodingProblem | undefined {
  if (/calculator|calc\b|src\/calculator/.test(lower) || looksLikeCalculator(lower)) return "calculator";
  if (/3\s*sum|three\s*sum|3sum|three_sum/.test(lower)) return "three-sum";
  if (/2\s*sum|two\s*sum|2sum|two_sum/.test(lower)) return "two-sum";
  if (/4\s*sum|four\s*sum|4sum|four_sum/.test(lower)) return "four-sum";
  if (/fizz\s*buzz/.test(lower)) return "fizzbuzz";
  if (/palindrome/.test(lower)) return "palindrome";
  if (/fibonacci/.test(lower)) return "fibonacci";
  if (/factorial/.test(lower)) return "factorial";
  if (/hello\s*world/.test(lower)) return "hello";
  return undefined;
}

function looksLikeCalculator(text: string) {
  const t = text.toLowerCase();
  if (/calculator|src\/calculator/.test(t)) return true;
  return (
    /\bdef add\b|\bfunction add\b/.test(t) &&
    /\bdef divide\b|\bfunction divide\b/.test(t) &&
    /\bdef calculate\b|\bfunction calculate\b/.test(t)
  );
}

export function calculatorExtras(prompt: string, source = "") {
  const blob = `${prompt}\n${source}`;
  return {
    modulo: /\bmod(ulo)?\b|remainder|%\s|def modulo|function modulo|ast\.mod/i.test(blob),
    gcdLcm: /hcf|gcd|lcm|highest common|least common|lowest common/i.test(blob),
  };
}

function inferVariant(blob: string): CodingVariant | undefined {
  if (/unordered_map|HashMap|seen = \{\}|seen := map/.test(blob)) return "hash";
  if (/i \+ 1[\s\S]*j \+ 1|nested loops|O\(n\^2\) brute/.test(blob)) return "brute";
  if (/l = i \+ 1|two pointers|int l = i \+ 1/.test(blob)) return "two-pointer";
  return undefined;
}

function defaultVariant(problem?: CodingProblem): CodingVariant {
  if (problem === "three-sum" || problem === "four-sum") return "two-pointer";
  return "hash";
}

function nextVariant(problem: CodingProblem | undefined, current?: CodingVariant): CodingVariant {
  if (problem === "two-sum") return current === "brute" ? "hash" : "brute";
  if (problem === "three-sum") return current === "hash" ? "two-pointer" : "hash";
  return defaultVariant(problem);
}

function pickSpec(problem: CodingProblem | undefined, lang: LangInfo, variant: CodingVariant, asked: string, source = "") {
  if (problem === "three-sum") return threeSum(lang, variant);
  if (problem === "two-sum") return twoSum(lang, variant);
  if (problem === "four-sum") return fourSum(lang);
  if (problem === "fizzbuzz") return fizzbuzz(lang);
  if (problem === "palindrome") return palindrome(lang);
  if (problem === "fibonacci") return fibonacci(lang);
  if (problem === "factorial") return factorial(lang);
  if (problem === "hello") return hello(lang);
  if (problem === "calculator" || looksLikeCalculator(source)) return calculator(lang, asked, source);
  return generic(asked, lang);
}

function file(path: string, language: string, content: string) {
  return { path, language, content };
}

function twoSum(lang: LangInfo, variant: CodingVariant = "hash") {
  if (variant === "brute") return twoSumBrute(lang);
  const sources: Record<Lang, string> = {
    python: `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        seen[n] = i
    return []


if __name__ == "__main__":
    print(two_sum([2, 7, 11, 15], 9))  # [0, 1]
`,
    javascript: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}

console.log(twoSum([2, 7, 11, 15], 9)); // [0, 1]
`,
    cpp: `#include <iostream>
#include <unordered_map>
#include <vector>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        if (seen.count(need)) return {seen[need], i};
        seen[nums[i]] = i;
    }
    return {};
}

int main() {
    vector<int> nums = {2, 7, 11, 15};
    auto ans = twoSum(nums, 9);
    cout << ans[0] << " " << ans[1] << "\\n";  // 0 1
    return 0;
}
`,
    java: `import java.util.*;

public class TwoSum {
    public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (seen.containsKey(need)) return new int[] {seen.get(need), i};
            seen.put(nums[i], i);
        }
        return new int[] {};
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(twoSum(new int[] {2, 7, 11, 15}, 9)));
    }
}
`,
    go: `package main

import "fmt"

func twoSum(nums []int, target int) []int {
    seen := map[int]int{}
    for i, n := range nums {
        if j, ok := seen[target-n]; ok {
            return []int{j, i}
        }
        seen[n] = i
    }
    return nil
}

func main() {
    fmt.Println(twoSum([]int{2, 7, 11, 15}, 9))
}
`,
  };
  return {
    title: "Two Sum",
    blurb: `Two Sum in ${lang.label}: indices of two numbers that add to target. Hash map, O(n).`,
    files: [file(`src/two_sum.${lang.ext}`, lang.id, sources[lang.id])],
  };
}

function twoSumBrute(lang: LangInfo) {
  const sources: Partial<Record<Lang, string>> = {
    python: `def two_sum(nums, target):
    n = len(nums)
    for i in range(n):
        for j in range(i + 1, n):
            if nums[i] + nums[j] == target:
                return [i, j]
    return []


if __name__ == "__main__":
    print(two_sum([2, 7, 11, 15], 9))  # [0, 1]
`,
    javascript: `function twoSum(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) return [i, j];
    }
  }
  return [];
}

console.log(twoSum([2, 7, 11, 15], 9));
`,
    cpp: `#include <iostream>
#include <vector>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    int n = (int)nums.size();
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            if (nums[i] + nums[j] == target) return {i, j};
        }
    }
    return {};
}

int main() {
    vector<int> nums = {2, 7, 11, 15};
    auto ans = twoSum(nums, 9);
    cout << ans[0] << " " << ans[1] << "\\n";  // 0 1
    return 0;
}
`,
  };
  const content = sources[lang.id] ?? sources.python!;
  const ext = sources[lang.id] ? lang.ext : "py";
  const language = sources[lang.id] ? lang.id : "python";
  return {
    title: "Two Sum",
    blurb: `Another method for Two Sum in ${lang.label}: nested loops, O(n²). Previous version used a hash map (O(n)).`,
    files: [file(`src/two_sum.${ext}`, language, content)],
  };
}

function threeSum(lang: LangInfo, variant: CodingVariant = "two-pointer") {
  if (variant === "hash") return threeSumHash(lang);
  const sources: Record<Lang, string> = {
    python: `def three_sum(nums):
    nums = sorted(nums)
    ans = []
    n = len(nums)
    for i in range(n):
        if i and nums[i] == nums[i - 1]:
            continue
        l, r = i + 1, n - 1
        while l < r:
            total = nums[i] + nums[l] + nums[r]
            if total == 0:
                ans.append([nums[i], nums[l], nums[r]])
                l += 1
                r -= 1
                while l < r and nums[l] == nums[l - 1]:
                    l += 1
                while l < r and nums[r] == nums[r + 1]:
                    r -= 1
            elif total < 0:
                l += 1
            else:
                r -= 1
    return ans


if __name__ == "__main__":
    print(three_sum([-1, 0, 1, 2, -1, -4]))
    # [[-1, -1, 2], [-1, 0, 1]]
`,
    javascript: `function threeSum(nums) {
  nums.sort((a, b) => a - b);
  const ans = [];
  for (let i = 0; i < nums.length; i++) {
    if (i && nums[i] === nums[i - 1]) continue;
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const total = nums[i] + nums[l] + nums[r];
      if (total === 0) {
        ans.push([nums[i], nums[l], nums[r]]);
        l++; r--;
        while (l < r && nums[l] === nums[l - 1]) l++;
        while (l < r && nums[r] === nums[r + 1]) r--;
      } else if (total < 0) l++;
      else r--;
    }
  }
  return ans;
}

console.log(threeSum([-1, 0, 1, 2, -1, -4]));
`,
    cpp: `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

vector<vector<int>> threeSum(vector<int> nums) {
    sort(nums.begin(), nums.end());
    vector<vector<int>> ans;
    int n = (int)nums.size();
    for (int i = 0; i < n; i++) {
        if (i > 0 && nums[i] == nums[i - 1]) continue;
        int l = i + 1, r = n - 1;
        while (l < r) {
            long long total = 1LL * nums[i] + nums[l] + nums[r];
            if (total == 0) {
                ans.push_back({nums[i], nums[l], nums[r]});
                l++;
                r--;
                while (l < r && nums[l] == nums[l - 1]) l++;
                while (l < r && nums[r] == nums[r + 1]) r--;
            } else if (total < 0) {
                l++;
            } else {
                r--;
            }
        }
    }
    return ans;
}

int main() {
    vector<int> nums = {-1, 0, 1, 2, -1, -4};
    auto res = threeSum(nums);
    for (auto& t : res) {
        cout << t[0] << " " << t[1] << " " << t[2] << "\\n";
    }
    // -1 -1 2
    // -1 0 1
    return 0;
}
`,
    java: `import java.util.*;

public class ThreeSum {
    public static List<List<Integer>> threeSum(int[] nums) {
        Arrays.sort(nums);
        List<List<Integer>> ans = new ArrayList<>();
        for (int i = 0; i < nums.length; i++) {
            if (i > 0 && nums[i] == nums[i - 1]) continue;
            int l = i + 1, r = nums.length - 1;
            while (l < r) {
                int total = nums[i] + nums[l] + nums[r];
                if (total == 0) {
                    ans.add(Arrays.asList(nums[i], nums[l], nums[r]));
                    l++; r--;
                    while (l < r && nums[l] == nums[l - 1]) l++;
                    while (l < r && nums[r] == nums[r + 1]) r--;
                } else if (total < 0) l++;
                else r--;
            }
        }
        return ans;
    }

    public static void main(String[] args) {
        System.out.println(threeSum(new int[] {-1, 0, 1, 2, -1, -4}));
    }
}
`,
    go: `package main

import (
    "fmt"
    "sort"
)

func threeSum(nums []int) [][]int {
    sort.Ints(nums)
    var ans [][]int
    for i := 0; i < len(nums); i++ {
        if i > 0 && nums[i] == nums[i-1] {
            continue
        }
        l, r := i+1, len(nums)-1
        for l < r {
            total := nums[i] + nums[l] + nums[r]
            if total == 0 {
                ans = append(ans, []int{nums[i], nums[l], nums[r]})
                l++
                r--
                for l < r && nums[l] == nums[l-1] {
                    l++
                }
                for l < r && nums[r] == nums[r+1] {
                    r--
                }
            } else if total < 0 {
                l++
            } else {
                r--
            }
        }
    }
    return ans
}

func main() {
    fmt.Println(threeSum([]int{-1, 0, 1, 2, -1, -4}))
}
`,
  };
  return {
    title: "Three Sum",
    blurb: `3-Sum in ${lang.label}: unique triplets that add to 0. Sort + two pointers, O(n²).`,
    files: [file(`src/three_sum.${lang.ext}`, lang.id, sources[lang.id])],
  };
}

function threeSumHash(lang: LangInfo) {
  const sources: Partial<Record<Lang, string>> = {
    python: `def three_sum(nums):
    nums = sorted(nums)
    ans = []
    n = len(nums)
    for i in range(n):
        if i and nums[i] == nums[i - 1]:
            continue
        seen = set()
        for j in range(i + 1, n):
            need = -nums[i] - nums[j]
            if need in seen:
                ans.append([nums[i], need, nums[j]])
                while j + 1 < n and nums[j] == nums[j + 1]:
                    j += 1
            seen.add(nums[j])
    return ans


if __name__ == "__main__":
    print(three_sum([-1, 0, 1, 2, -1, -4]))
`,
    cpp: `#include <algorithm>
#include <iostream>
#include <unordered_set>
#include <vector>
using namespace std;

vector<vector<int>> threeSum(vector<int> nums) {
    sort(nums.begin(), nums.end());
    vector<vector<int>> ans;
    int n = (int)nums.size();
    for (int i = 0; i < n; i++) {
        if (i && nums[i] == nums[i - 1]) continue;
        unordered_set<int> seen;
        for (int j = i + 1; j < n; j++) {
            int need = -nums[i] - nums[j];
            if (seen.count(need)) {
                ans.push_back({nums[i], need, nums[j]});
                while (j + 1 < n && nums[j] == nums[j + 1]) j++;
            }
            seen.insert(nums[j]);
        }
    }
    return ans;
}

int main() {
    vector<int> nums = {-1, 0, 1, 2, -1, -4};
    for (auto& t : threeSum(nums)) {
        cout << t[0] << " " << t[1] << " " << t[2] << "\\n";
    }
    return 0;
}
`,
  };
  const content = sources[lang.id] ?? sources.python!;
  const ext = sources[lang.id] ? lang.ext : "py";
  const language = sources[lang.id] ? lang.id : "python";
  return {
    title: "Three Sum",
    blurb: `Another method for 3-Sum in ${lang.label}: hash set per index. Previous version used sort + two pointers.`,
    files: [file(`src/three_sum.${ext}`, language, content)],
  };
}

function fourSum(lang: LangInfo) {
  const py = `def four_sum(nums, target):
    nums = sorted(nums)
    n, ans = len(nums), []
    for i in range(n):
        if i and nums[i] == nums[i - 1]:
            continue
        for j in range(i + 1, n):
            if j > i + 1 and nums[j] == nums[j - 1]:
                continue
            l, r = j + 1, n - 1
            while l < r:
                total = nums[i] + nums[j] + nums[l] + nums[r]
                if total == target:
                    ans.append([nums[i], nums[j], nums[l], nums[r]])
                    l += 1
                    r -= 1
                    while l < r and nums[l] == nums[l - 1]:
                        l += 1
                    while l < r and nums[r] == nums[r + 1]:
                        r -= 1
                elif total < target:
                    l += 1
                else:
                    r -= 1
    return ans
`;
  const cpp = `#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

vector<vector<int>> fourSum(vector<int> nums, int target) {
    sort(nums.begin(), nums.end());
    vector<vector<int>> ans;
    int n = (int)nums.size();
    for (int i = 0; i < n; i++) {
        if (i && nums[i] == nums[i - 1]) continue;
        for (int j = i + 1; j < n; j++) {
            if (j > i + 1 && nums[j] == nums[j - 1]) continue;
            int l = j + 1, r = n - 1;
            while (l < r) {
                long long total = 1LL * nums[i] + nums[j] + nums[l] + nums[r];
                if (total == target) {
                    ans.push_back({nums[i], nums[j], nums[l], nums[r]});
                    l++; r--;
                    while (l < r && nums[l] == nums[l - 1]) l++;
                    while (l < r && nums[r] == nums[r + 1]) r--;
                } else if (total < target) l++;
                else r--;
            }
        }
    }
    return ans;
}

int main() {
    vector<int> nums = {1, 0, -1, 0, -2, 2};
    for (auto& t : fourSum(nums, 0)) {
        cout << t[0] << " " << t[1] << " " << t[2] << " " << t[3] << "\\n";
    }
    return 0;
}
`;
  const content = lang.id === "cpp" ? cpp : py;
  const ext = lang.id === "cpp" ? "cpp" : lang.id === "python" ? "py" : lang.ext;
  const language = lang.id === "cpp" ? "cpp" : "python";
  return {
    title: "Four Sum",
    blurb: `4-Sum in ${lang.label}: unique quadruplets that add to target.`,
    files: [file(`src/four_sum.${ext}`, language, content)],
  };
}

function fizzbuzz(lang: LangInfo) {
  const py = `def fizzbuzz(n):
    out = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            out.append("FizzBuzz")
        elif i % 3 == 0:
            out.append("Fizz")
        elif i % 5 == 0:
            out.append("Buzz")
        else:
            out.append(str(i))
    return out


if __name__ == "__main__":
    print(fizzbuzz(15))
`;
  const cpp = `#include <iostream>
#include <string>
#include <vector>
using namespace std;

vector<string> fizzbuzz(int n) {
    vector<string> out;
    for (int i = 1; i <= n; i++) {
        if (i % 15 == 0) out.push_back("FizzBuzz");
        else if (i % 3 == 0) out.push_back("Fizz");
        else if (i % 5 == 0) out.push_back("Buzz");
        else out.push_back(to_string(i));
    }
    return out;
}

int main() {
    for (auto& s : fizzbuzz(15)) cout << s << "\\n";
    return 0;
}
`;
  const js = `function fizzbuzz(n) {
  return Array.from({ length: n }, (_, i) => {
    const x = i + 1;
    if (x % 15 === 0) return "FizzBuzz";
    if (x % 3 === 0) return "Fizz";
    if (x % 5 === 0) return "Buzz";
    return String(x);
  });
}
console.log(fizzbuzz(15));
`;
  const content = lang.id === "cpp" ? cpp : lang.id === "javascript" ? js : py;
  return {
    title: "FizzBuzz",
    blurb: `FizzBuzz in ${lang.label}.`,
    files: [file(`src/fizzbuzz.${lang.ext}`, lang.id, content)],
  };
}

function palindrome(lang: LangInfo) {
  const py = `def is_palindrome(s):
    cleaned = "".join(ch.lower() for ch in s if ch.isalnum())
    return cleaned == cleaned[::-1]


if __name__ == "__main__":
    print(is_palindrome("Never odd or even"))
`;
  const cpp = `#include <cctype>
#include <iostream>
#include <string>
using namespace std;

bool isPalindrome(string s) {
    string cleaned;
    for (char ch : s) if (isalnum((unsigned char)ch)) cleaned += tolower((unsigned char)ch);
    return cleaned == string(cleaned.rbegin(), cleaned.rend());
}

int main() {
    cout << boolalpha << isPalindrome("Never odd or even") << "\\n";
    return 0;
}
`;
  const content = lang.id === "cpp" ? cpp : py;
  return {
    title: "Palindrome",
    blurb: `Palindrome check in ${lang.label}.`,
    files: [file(`src/palindrome.${lang.id === "cpp" ? "cpp" : "py"}`, lang.id === "cpp" ? "cpp" : "python", content)],
  };
}

function fibonacci(lang: LangInfo) {
  const py = `def fibonacci(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b


if __name__ == "__main__":
    print([fibonacci(i) for i in range(10)])
`;
  const cpp = `#include <iostream>
using namespace std;

long long fibonacci(int n) {
    if (n <= 1) return n;
    long long a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        long long next = a + b;
        a = b;
        b = next;
    }
    return b;
}

int main() {
    for (int i = 0; i < 10; i++) cout << fibonacci(i) << " ";
    cout << "\\n";
    return 0;
}
`;
  const content = lang.id === "cpp" ? cpp : py;
  return {
    title: "Fibonacci",
    blurb: `Nth Fibonacci in ${lang.label}.`,
    files: [file(`src/fibonacci.${lang.id === "cpp" ? "cpp" : "py"}`, lang.id === "cpp" ? "cpp" : "python", content)],
  };
}

function factorial(lang: LangInfo) {
  const py = `def factorial(n):
    if n < 0:
        raise ValueError("n must be >= 0")
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result


if __name__ == "__main__":
    print(factorial(5))
`;
  const cpp = `#include <iostream>
using namespace std;

long long factorial(int n) {
    long long result = 1;
    for (int i = 2; i <= n; i++) result *= i;
    return result;
}

int main() {
    cout << factorial(5) << "\\n";
    return 0;
}
`;
  const content = lang.id === "cpp" ? cpp : py;
  return {
    title: "Factorial",
    blurb: `Factorial in ${lang.label}.`,
    files: [file(`src/factorial.${lang.id === "cpp" ? "cpp" : "py"}`, lang.id === "cpp" ? "cpp" : "python", content)],
  };
}

function hello(lang: LangInfo) {
  const sources: Partial<Record<Lang, string>> = {
    python: `print("Hello, ForgeAI")\n`,
    javascript: `console.log("Hello, ForgeAI");\n`,
    cpp: `#include <iostream>
int main() {
    std::cout << "Hello, ForgeAI\\n";
    return 0;
}
`,
    java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, ForgeAI");
    }
}
`,
    go: `package main
import "fmt"
func main() { fmt.Println("Hello, ForgeAI") }
`,
  };
  return {
    title: "Hello World",
    blurb: `Hello World in ${lang.label}.`,
    files: [file(`src/main.${lang.ext}`, lang.id, sources[lang.id] ?? sources.python!)],
  };
}

function calculator(lang: LangInfo, asked = "", source = "") {
  const extras = calculatorExtras(asked, source);
  const withMod = extras.modulo;
  const withGcdLcm = extras.gcdLcm;
  const parts = ["add", "subtract", "multiply", "divide"];
  if (withMod) parts.push("modulo");
  if (withGcdLcm) parts.push("hcf/gcd", "lcm");
  const ops = parts.join(" / ");
  const pythonMod = withMod
    ? `

def modulo(a, b):
    if b == 0:
        raise ValueError("Cannot modulo by zero")
    return a % b
`
    : "";
  const pythonGcdLcm = withGcdLcm
    ? `

def hcf(a, b):
    a, b = abs(int(a)), abs(int(b))
    while b:
        a, b = b, a % b
    return a


def gcd(a, b):
    return hcf(a, b)


def lcm(a, b):
    a, b = int(a), int(b)
    if a == 0 or b == 0:
        return 0
    return abs(a * b) // hcf(a, b)
`
    : "";
  const pythonOps = withMod
    ? `        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Mod: operator.mod,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,`
    : `        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,`;
  const pythonZero = withMod
    ? `            if isinstance(node.op, (ast.Div, ast.Mod)) and right == 0:
                raise ValueError("Cannot divide by zero")`
    : `            if isinstance(node.op, ast.Div) and right == 0:
                raise ValueError("Cannot divide by zero")`;
  const pythonMainExtras = [
    withMod ? `    print(calculate("10 % 3"))         # 1` : "",
    withGcdLcm ? `    print(hcf(12, 18), lcm(12, 18))    # 6 36` : "",
  ].filter(Boolean);
  const pythonCall = ["add(10, 5)", "subtract(10, 5)", "multiply(10, 5)", "divide(10, 5)"];
  if (withMod) pythonCall.push("modulo(10, 3)");
  if (withGcdLcm) pythonCall.push("hcf(12, 18)", "lcm(12, 18)");
  const pythonMain = `    print(calculate("2 + 3 * 4"))      # 14
    print(calculate("(2 + 3) * 4"))    # 20
${pythonMainExtras.length ? pythonMainExtras.join("\n") + "\n" : ""}    print(${pythonCall.join(", ")})
`;
  const python = `def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def multiply(a, b):
    return a * b


def divide(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
${pythonMod}${pythonGcdLcm}

def calculate(expression):
    """Evaluate +, -, *, /${withMod ? ", %" : ""} and parentheses. No variables or calls."""
    import ast
    import operator

    ops = {
${pythonOps}
    }

    def eval_node(node):
        if isinstance(node, ast.Expression):
            return eval_node(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.UnaryOp) and type(node.op) in ops:
            return ops[type(node.op)](eval_node(node.operand))
        if isinstance(node, ast.BinOp) and type(node.op) in ops:
            left = eval_node(node.left)
            right = eval_node(node.right)
${pythonZero}
            return ops[type(node.op)](left, right)
        raise ValueError("Unsupported expression")

    tree = ast.parse(expression.replace(" ", ""), mode="eval")
    return eval_node(tree)


if __name__ == "__main__":
${pythonMain}`;
  const jsMod = withMod
    ? `
function modulo(a, b) {
  if (b === 0) throw new Error("Cannot modulo by zero");
  return a % b;
}
`
    : "";
  const jsGcdLcm = withGcdLcm
    ? `
function hcf(a, b) {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}
function gcd(a, b) { return hcf(a, b); }
function lcm(a, b) {
  a = Math.trunc(a);
  b = Math.trunc(b);
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / hcf(a, b);
}
`
    : "";
  const jsToken = withMod ? "[-+*/%()]" : "[-+*/()]";
  const jsTermOps = withMod ? `peek() === "*" || peek() === "/" || peek() === "%"` : `peek() === "*" || peek() === "/"`;
  const jsTermApply = withMod
    ? `      if ((op === "/" || op === "%") && right === 0) throw new Error("Cannot divide by zero");
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;`
    : `      if (op === "/" && right === 0) throw new Error("Cannot divide by zero");
      left = op === "*" ? left * right : left / right;`;
  const javascript = `function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function multiply(a, b) { return a * b; }
function divide(a, b) {
  if (b === 0) throw new Error("Cannot divide by zero");
  return a / b;
}
${jsMod}${jsGcdLcm}
function calculate(expression) {
  const tokens = expression.replace(/\\s+/g, "").match(/\\d+\\.?\\d*|${jsToken}/g) || [];
  let i = 0;
  function peek() { return tokens[i]; }
  function eat(tok) {
    if (peek() !== tok) throw new Error("Bad expression");
    i += 1;
  }
  function parseExpr() {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      eat(op);
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (${jsTermOps}) {
      const op = peek();
      eat(op);
      const right = parseFactor();
${jsTermApply}
    }
    return left;
  }
  function parseFactor() {
    if (peek() === "(") {
      eat("(");
      const value = parseExpr();
      eat(")");
      return value;
    }
    const n = Number(peek());
    if (Number.isNaN(n)) throw new Error("Bad expression");
    i += 1;
    return n;
  }
  return parseExpr();
}

console.log(calculate("2 + 3 * 4"));
console.log(calculate("(2 + 3) * 4"));${withMod ? `\nconsole.log(modulo(10, 3));` : ""}${withGcdLcm ? `\nconsole.log(hcf(12, 18), lcm(12, 18));` : ""}
`;
  const cppMod = withMod
    ? `
double modulo(double a, double b) {
    if (b == 0) throw invalid_argument("Cannot modulo by zero");
    return std::fmod(a, b);
}
`
    : "";
  const cppGcdLcm = withGcdLcm
    ? `
long long hcf(long long a, long long b) {
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b) {
        long long t = b;
        b = a % b;
        a = t;
    }
    return a;
}
long long gcd(long long a, long long b) { return hcf(a, b); }
long long lcm(long long a, long long b) {
    if (a == 0 || b == 0) return 0;
    return llabs(a / hcf(a, b) * b);
}
`
    : "";
  const cpp = `#include <iostream>
#include <stdexcept>
${withMod ? `#include <cmath>\n` : ""}using namespace std;

double add(double a, double b) { return a + b; }
double subtract(double a, double b) { return a - b; }
double multiply(double a, double b) { return a * b; }
double divide(double a, double b) {
    if (b == 0) throw invalid_argument("Cannot divide by zero");
    return a / b;
}
${cppMod}${cppGcdLcm}
int main() {
    cout << add(10, 5) << " " << subtract(10, 5) << " "
         << multiply(10, 5) << " " << divide(10, 5)${withMod ? ` << " " << modulo(10, 3)` : ""}${withGcdLcm ? ` << " " << hcf(12, 18) << " " << lcm(12, 18)` : ""} << "\\n";
    return 0;
}
`;
  const sources: Partial<Record<Lang, string>> = { python, javascript, cpp };
  const content = sources[lang.id] ?? python;
  const ext = sources[lang.id] ? lang.ext : "py";
  const language = sources[lang.id] ? lang.id : "python";
  return {
    title: "Calculator",
    blurb: `${lang.id === "python" || !sources[lang.id] ? "Python" : lang.label} calculator with ${ops}, plus \`calculate("2 + 3 * 4")\` for expressions.${withMod ? " Modulo is \`modulo(a, b)\` and \`%\`." : ""}${withGcdLcm ? " HCF/GCD and LCM are \`hcf(a, b)\` and \`lcm(a, b)\`." : ""}`,
    files: [file(`src/calculator.${ext}`, language, content)],
  };
}

function frontendPage(lower: string) {
  const calc = /calculator|calc\b/.test(lower);
  if (calc) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Calculator</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="card">
    <h1>Calculator</h1>
    <input id="display" aria-label="Expression" placeholder="2 + 3 * 4" />
    <div class="row">
      <button type="button" data-key="7">7</button>
      <button type="button" data-key="8">8</button>
      <button type="button" data-key="9">9</button>
      <button type="button" data-key="/">/</button>
      <button type="button" data-key="4">4</button>
      <button type="button" data-key="5">5</button>
      <button type="button" data-key="6">6</button>
      <button type="button" data-key="*">*</button>
      <button type="button" data-key="1">1</button>
      <button type="button" data-key="2">2</button>
      <button type="button" data-key="3">3</button>
      <button type="button" data-key="-">-</button>
      <button type="button" data-key="0">0</button>
      <button type="button" data-key=".">.</button>
      <button type="button" id="equals">=</button>
      <button type="button" data-key="+">+</button>
    </div>
    <button type="button" id="clear">Clear</button>
    <p id="error" role="alert"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;
    const css = `body { font-family: sans-serif; background: #12151c; color: #f3f6fb; display: grid; place-items: center; min-height: 100vh; }
.card { width: 280px; background: #171b22; padding: 20px; border-radius: 16px; }
input, button { font-size: 16px; }
input { width: 100%; margin: 12px 0; padding: 10px; }
.row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
button { padding: 10px; cursor: pointer; }
#error { color: #f87171; min-height: 1.2em; }
`;
    const js = `const display = document.getElementById("display");
const error = document.getElementById("error");

document.querySelectorAll("[data-key]").forEach((btn) => {
  btn.addEventListener("click", () => {
    display.value += btn.getAttribute("data-key");
  });
});

document.getElementById("clear").onclick = () => {
  display.value = "";
  error.textContent = "";
};

document.getElementById("equals").onclick = () => {
  error.textContent = "";
  try {
    if (!/^[0-9+\\-*/(). ]+$/.test(display.value)) throw new Error("Invalid");
    display.value = String(Function(\`"use strict"; return (\${display.value})\`)());
  } catch (err) {
    error.textContent = err.message || "Could not calculate";
  }
};
`;
    return {
      title: "Calculator UI",
      blurb: "Frontend calculator: HTML + CSS + JS. Open the Code tab — this is a UI, not a DSA problem.",
      files: [file("index.html", "html", html), file("styles.css", "css", css), file("app.js", "javascript", js)],
    };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Forge project</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>Your project</h1>
    <p>Starter frontend. Tell me what to add next.</p>
  </header>
  <main>
    <button type="button" id="action">Get started</button>
    <p id="status"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;
  const css = `body { font-family: sans-serif; background: #12151c; color: #f3f6fb; margin: 0; }
header, main { max-width: 640px; margin: 0 auto; padding: 32px 20px; }
button { background: #7dd3fc; border: 0; padding: 10px 16px; cursor: pointer; }
`;
  const js = `document.getElementById("action").onclick = () => {
  document.getElementById("status").textContent = "Ready — tell Forge what to build next.";
};
`;
  return {
    title: "Frontend starter",
    blurb: "Starter frontend (HTML/CSS/JS). Testing will run a UI smoke checklist, not DSA examples.",
    files: [file("index.html", "html", html), file("styles.css", "css", css), file("app.js", "javascript", js)],
  };
}

function generic(prompt: string, lang: LangInfo) {
  const stem = fileStem(prompt) || "solution";
  const py = `def ${stem.replace(/-/g, "_")}():
    raise NotImplementedError(${JSON.stringify(prompt)})
`;
  const cpp = `#include <iostream>
using namespace std;

// ${prompt.replace(/\n/g, " ")}
int main() {
    cout << "TODO\\n";
    return 0;
}
`;
  const content = lang.id === "cpp" ? cpp : lang.id === "python" ? py : cpp;
  return {
    title: prompt.slice(0, 48),
    blurb: `Started a ${lang.label} file. Tell me the exact problem (e.g. “3 sum in c++”) and I’ll write the full solution.`,
    files: [file(`src/${stem}.${lang.ext}`, lang.id, content)],
  };
}

function fileStem(text: string) {
  return text
    .toLowerCase()
    .replace(/okay|please|write|the|code|of|in|for|a|an|me|to|implement|create|program/g, " ")
    .replace(/c\+\+|cpp|python|javascript|typescript|java|golang|\bgo\b|\bjs\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 32);
}
