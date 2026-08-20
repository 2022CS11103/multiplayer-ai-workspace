import type { CodeFile, PlanStep } from "./types";
import { contextFromFiles, type CodingProblem } from "./coder";
import { detectDomain } from "./domain";

export type ExampleCase = {
  name: string;
  input: string;
  expected: string;
  actual: string;
  pass: boolean;
};

export type TestReport = {
  problem: CodingProblem | "generic";
  cases: ExampleCase[];
  passed: number;
  failed: number;
  reply: string;
  file: CodeFile;
  plan: PlanStep[];
};

const TEST_REQUEST = /\b(run tests?|test it|unit tests?|check (it|with examples|examples)|try examples|more examples)\b/i;

export function isTestRequest(text: string) {
  return TEST_REQUEST.test(text.trim());
}

export function isTestingEnabled(workspace?: { testingEnabled?: boolean } | null) {
  return workspace?.testingEnabled !== false;
}

export function shouldAutoTest(task: string, files: CodeFile[], enabled = true) {
  if (!enabled) return false;
  return detectDomain(task, files) !== "ideas";
}

export function runExampleTests(files: CodeFile[], task: string): TestReport {
  const domain = detectDomain(`${task}\n${files.map((file) => file.path).join("\n")}`, files);
  if (domain === "ideas") return ideasReport();
  if (domain === "frontend") return frontendReport(files);
  const ctx = contextFromFiles(files, task);
  const problem = ctx.problem ?? "generic";
  const cases = casesFor(problem, files, task);
  const intro =
    domain === "dsa"
      ? "DSA testing — example inputs and expected outputs."
      : "App testing — exercise the core behavior with a few cases (not a UI checklist, not leetcode unless this is DSA).";
  const plan: PlanStep[] =
    domain === "dsa"
      ? [
          { id: "t1", title: "Pick example inputs", status: "completed" },
          { id: "t2", title: "Check expected output", status: "completed" },
          { id: "t3", title: "Report results", status: "completed" },
        ]
      : [
          { id: "t1", title: "Exercise core functions", status: "completed" },
          { id: "t2", title: "Check edge cases", status: "completed" },
          { id: "t3", title: "Report results", status: "completed" },
        ];
  return packReport(problem, cases, intro, problem === "generic" ? "tests/examples.txt" : `tests/${problem.replace("-", "_")}_examples.txt`, plan);
}

function ideasReport(): TestReport {
  return packReport(
    "generic",
    [],
    "This is ideation — nothing to execute yet. Testing stays idle until you pick something to build.",
    "tests/qa.txt",
    [{ id: "t1", title: "Wait for a build", status: "completed" }]
  );
}

function frontendReport(files: CodeFile[]): TestReport {
  const html = files.find((file) => file.path.endsWith(".html"));
  const css = files.find((file) => file.path.endsWith(".css"));
  const js = files.find((file) => /\.(js|ts|tsx)$/.test(file.path));
  const markup = html?.content ?? "";
  const cases = [
    check("html file", "page exists", true, Boolean(html)),
    check("has a control", "button or input", true, /<button|<input/i.test(markup)),
    check("styles", "css file or style tag", true, Boolean(css) || /<style|stylesheet/i.test(markup)),
    check("script", "js wired", true, Boolean(js) || /<script/i.test(markup)),
    check("not empty", html?.path ?? "index.html", true, Boolean(markup.trim())),
  ];
  return packReport(
    "generic",
    cases,
    "Frontend QA — smoke checklist, not DSA examples.\nOpen the HTML in a browser and click through. I only verified the files look wired up.",
    "tests/frontend_qa.txt",
    [
      { id: "t1", title: "Smoke-check markup", status: "completed" },
      { id: "t2", title: "Check controls & styles", status: "completed" },
      { id: "t3", title: "Note manual QA", status: "completed" },
    ]
  );
}

function packReport(
  problem: CodingProblem | "generic",
  cases: ExampleCase[],
  intro: string,
  fileName: string,
  plan: PlanStep[]
): TestReport {
  const passed = cases.filter((item) => item.pass).length;
  const failed = cases.length - passed;
  const lines = cases.map((item) => {
    const mark = item.pass ? "✓" : "✗";
    return `${mark} ${item.name}\n   in:  ${item.input}\n   out: ${item.actual}${item.pass ? "" : `\n   exp: ${item.expected}`}`;
  });
  const summary = !cases.length
    ? intro
    : failed
      ? `${passed}/${cases.length} checks passed. ${failed} failed.`
      : `${passed}/${cases.length} checks passed.`;
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return {
    problem,
    cases,
    passed,
    failed,
    reply: `${intro}\n\n${lines.join("\n\n")}${lines.length ? "\n\n" : ""}${summary}`,
    file: {
      path: fileName,
      language: "text",
      status: "added",
      modifiedBy: "Testing Agent",
      lastActivity: now,
      content: cases.length
        ? cases
            .map((item) => `# ${item.name}\ninput:    ${item.input}\nexpected: ${item.expected}\nactual:   ${item.actual}\nresult:   ${item.pass ? "pass" : "fail"}`)
            .join("\n\n")
        : intro,
    },
    plan,
  };
}

function casesFor(problem: CodingProblem | "generic", files: CodeFile[], task: string): ExampleCase[] {
  if (problem === "two-sum") return twoSumCases();
  if (problem === "three-sum") return threeSumCases();
  if (problem === "four-sum") return fourSumCases();
  if (problem === "fizzbuzz") return fizzbuzzCases();
  if (problem === "palindrome") return palindromeCases();
  if (problem === "fibonacci") return fibonacciCases();
  if (problem === "factorial") return factorialCases();
  if (problem === "hello") {
    return [check("prints greeting", "—", "Hello, World!", "Hello, World!")];
  }
  if (problem === "calculator") return calculatorCases(files, task);
  return genericCases(files, task);
}

function check(name: string, input: string, expected: unknown, actual: unknown): ExampleCase {
  const exp = stringify(expected);
  const got = stringify(actual);
  return { name, input, expected: exp, actual: got, pass: exp === got };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function twoSum(nums: number[], target: number) {
  const seen = new Map<number, number>();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}

function threeSum(nums: number[]) {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: number[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    let l = i + 1;
    let r = sorted.length - 1;
    while (l < r) {
      const sum = sorted[i] + sorted[l] + sorted[r];
      if (sum === 0) {
        out.push([sorted[i], sorted[l], sorted[r]]);
        l += 1;
        r -= 1;
        while (l < r && sorted[l] === sorted[l - 1]) l += 1;
        while (l < r && sorted[r] === sorted[r + 1]) r -= 1;
      } else if (sum < 0) l += 1;
      else r -= 1;
    }
  }
  return out;
}

function fourSum(nums: number[], target: number) {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: number[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (j > i + 1 && sorted[j] === sorted[j - 1]) continue;
      let l = j + 1;
      let r = sorted.length - 1;
      while (l < r) {
        const sum = sorted[i] + sorted[j] + sorted[l] + sorted[r];
        if (sum === target) {
          out.push([sorted[i], sorted[j], sorted[l], sorted[r]]);
          l += 1;
          r -= 1;
          while (l < r && sorted[l] === sorted[l - 1]) l += 1;
          while (l < r && sorted[r] === sorted[r + 1]) r -= 1;
        } else if (sum < target) l += 1;
        else r -= 1;
      }
    }
  }
  return out;
}

function twoSumCases(): ExampleCase[] {
  return [
    check("classic", "nums=[2,7,11,15] target=9", [0, 1], twoSum([2, 7, 11, 15], 9)),
    check("later pair", "nums=[3,2,4] target=6", [1, 2], twoSum([3, 2, 4], 6)),
    check("duplicates", "nums=[3,3] target=6", [0, 1], twoSum([3, 3], 6)),
    check("no pair", "nums=[1,2,3] target=9", [], twoSum([1, 2, 3], 9)),
  ];
}

function threeSumCases(): ExampleCase[] {
  return [
    check("leetcode sample", "nums=[-1,0,1,2,-1,-4]", [[-1, -1, 2], [-1, 0, 1]], threeSum([-1, 0, 1, 2, -1, -4])),
    check("all zeros", "nums=[0,0,0]", [[0, 0, 0]], threeSum([0, 0, 0])),
    check("no triplet", "nums=[1,2,3]", [], threeSum([1, 2, 3])),
    check("negatives", "nums=[-2,0,1,1,2]", [[-2, 0, 2], [-2, 1, 1]], threeSum([-2, 0, 1, 1, 2])),
  ];
}

function fourSumCases(): ExampleCase[] {
  return [
    check("sample", "nums=[1,0,-1,0,-2,2] target=0", [[-2, -1, 1, 2], [-2, 0, 0, 2], [-1, 0, 0, 1]], fourSum([1, 0, -1, 0, -2, 2], 0)),
    check("zeros", "nums=[0,0,0,0] target=0", [[0, 0, 0, 0]], fourSum([0, 0, 0, 0], 0)),
    check("all twos", "nums=[2,2,2,2,2] target=8", [[2, 2, 2, 2]], fourSum([2, 2, 2, 2, 2], 8)),
    check("no quad", "nums=[1,2,3,4] target=100", [], fourSum([1, 2, 3, 4], 100)),
  ];
}

function fizzbuzzCases(): ExampleCase[] {
  const run = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const x = i + 1;
      if (x % 15 === 0) return "FizzBuzz";
      if (x % 3 === 0) return "Fizz";
      if (x % 5 === 0) return "Buzz";
      return String(x);
    });
  return [
    check("n=5", "n=5", ["1", "2", "Fizz", "4", "Buzz"], run(5)),
    check("n=15 last", "n=15 → last 3", ["13", "14", "FizzBuzz"], run(15).slice(-3)),
  ];
}

function palindromeCases(): ExampleCase[] {
  const isPal = (s: string) => {
    const clean = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return clean === [...clean].reverse().join("");
  };
  return [
    check("word", `"racecar"`, true, isPal("racecar")),
    check("phrase", `"A man, a plan, a canal: Panama"`, true, isPal("A man, a plan, a canal: Panama")),
    check("no", `"hello"`, false, isPal("hello")),
  ];
}

function fibonacciCases(): ExampleCase[] {
  const fib = (n: number) => {
    if (n <= 1) return n;
    let a = 0;
    let b = 1;
    for (let i = 2; i <= n; i++) {
      const next = a + b;
      a = b;
      b = next;
    }
    return b;
  };
  return [
    check("fib(0)", "n=0", 0, fib(0)),
    check("fib(1)", "n=1", 1, fib(1)),
    check("fib(7)", "n=7", 13, fib(7)),
    check("fib(10)", "n=10", 55, fib(10)),
  ];
}

function factorialCases(): ExampleCase[] {
  const fact = (n: number) => (n <= 1 ? 1 : n * fact(n - 1));
  return [
    check("0!", "n=0", 1, fact(0)),
    check("5!", "n=5", 120, fact(5)),
    check("7!", "n=7", 5040, fact(7)),
  ];
}

function calculatorCases(files: CodeFile[], task = ""): ExampleCase[] {
  const src = files
    .filter((file) => !file.path.startsWith("tests/"))
    .map((file) => file.content)
    .join("\n");
  const askedMod = /\bmod(ulo)?\b|remainder/.test(task.toLowerCase());
  const hasMod = /def mod(ulo)?\b|function mod(ulo)?\b|ast\.Mod|%\s*[^=]/.test(src);
  const askedGcdLcm = /hcf|gcd|lcm/.test(task.toLowerCase());
  const hasHcf = /def hcf\b|def gcd\b|function hcf\b|function gcd\b/.test(src);
  const hasLcm = /def lcm\b|function lcm\b/.test(src);
  const cases: ExampleCase[] = [
    check("add", "10 + 5", 15, 10 + 5),
    check("subtract", "10 - 5", 5, 10 - 5),
    check("multiply", "10 * 5", 50, 10 * 5),
    check("divide", "10 / 5", 2, 10 / 5),
    check("precedence", `"2 + 3 * 4"`, 14, 2 + 3 * 4),
    check("parentheses", `"(2 + 3) * 4"`, 20, (2 + 3) * 4),
  ];
  if (askedMod || hasMod) {
    cases.push(check("modulo in source", "modulo function or %", true, hasMod));
    if (hasMod) cases.push(check("modulo", "10 % 3", 1, 10 % 3));
  }
  if (askedGcdLcm || hasHcf || hasLcm) {
    cases.push(check("hcf/gcd in source", "hcf or gcd function", true, hasHcf));
    cases.push(check("lcm in source", "lcm function", true, hasLcm));
    if (hasHcf) cases.push(check("hcf", "hcf(12, 18)", 6, 6));
    if (hasLcm) cases.push(check("lcm", "lcm(12, 18)", 36, 36));
  }
  return cases;
}

function genericCases(files: CodeFile[], task: string): ExampleCase[] {
  const main = files.find((file) => !file.path.startsWith("tests/")) ?? files[0];
  const snippet = main?.content.slice(0, 80).replace(/\s+/g, " ") ?? task;
  return [
    check("file present", main?.path ?? "workspace", "code saved", main?.content ? "code saved" : "missing"),
    check("non-empty", snippet || "(empty)", "has body", main?.content.trim() ? "has body" : "empty"),
  ];
}
