export type ProjectDomain = "dsa" | "app" | "frontend" | "ideas";
export type IdeaLevel = "starter" | "expert";

const DSA =
  /\b(two\s*sum|three\s*sum|four\s*sum|\d\s*sum|2sum|3sum|4sum|leetcode|fizz\s*buzz|palindrome|fibonacci|factorial|binary search)\b/i;

const FRONTEND =
  /\b(frontend|front-end|html|css|react|next\.?js|landing page|website|web page|ui|tailwind)\b/i;

const IDEAS = /\b(suggest|ideas?|brainstorm|inspire|what should i build|project ideas|good project)\b/i;

const IDEA_FOLLOW =
  /\b(expert|advanced|harder|harder ones|more (ideas|hard|serious)|senior|production|complex|difficult|beginner|easier|simple|starter|another (one|idea|list))\b/i;

export function isIdeaRequest(text: string) {
  return IDEAS.test(text) && !/\bwrite\b.*\bcode\b/i.test(text);
}

export function isIdeaFollowUp(text: string) {
  return IDEA_FOLLOW.test(text) && !/\b(write|implement|build this|code for)\b/i.test(text);
}

export function ideaLevel(text: string): IdeaLevel {
  if (/\b(expert|advanced|harder|senior|production|complex|difficult|serious)\b/i.test(text)) return "expert";
  return "starter";
}

export function isFrontendRequest(text: string) {
  return FRONTEND.test(text);
}

export function isDsaRequest(text: string) {
  return DSA.test(text);
}

export function detectDomain(text: string, files: { path?: string }[] = []): ProjectDomain {
  const paths = files.map((file) => file.path ?? "").join(" ");
  const hasUiFile = files.some((file) => /\.(html|css)$/i.test(file.path ?? ""));
  const hasAppFile = files.some((file) => /\.(py|cpp|c|java|go|rs)$/i.test(file.path ?? "") || /calculator/i.test(file.path ?? ""));
  if (hasUiFile && !hasAppFile) return "frontend";
  if (hasAppFile) {
    if (isDsaRequest(`${text} ${paths}`) || /two_sum|three_sum|four_sum/.test(paths)) return "dsa";
    return "app";
  }
  const blob = `${text} ${paths}`.toLowerCase();
  if (isIdeaRequest(blob)) return "ideas";
  if (/\.html\b|\.css\b/.test(blob) || isFrontendRequest(blob)) return "frontend";
  if (isDsaRequest(blob) || /two_sum|three_sum|four_sum/.test(blob)) return "dsa";
  return "app";
}

export function domainLabel(domain: ProjectDomain) {
  if (domain === "dsa") return "DSA";
  if (domain === "frontend") return "Frontend";
  if (domain === "ideas") return "Ideas";
  return "App";
}

export function suggestIdeas(prompt: string) {
  const level = ideaLevel(prompt);
  if (level === "expert") {
    return {
      title: "Expert project ideas",
      reply: `Expert-level — pick one and say “build this” (Python) or “write the frontend”.

**Best pick:** a tiny language + VM. Lexer → parser → bytecode → execute. That’s compiler + runtime in one repo, and Testing can run programs as examples.

1. **Mini language + bytecode VM** — tokenize, parse to AST, compile to ops, run a REPL. Python.
2. **CRDT collaborative notes** — two users type, last-write-wins isn’t enough; implement a list/text CRDT and sync.
3. **Inverted-index search** — tokenize docs, postings lists, boolean AND/OR, rank by TF-IDF.
4. **Canvas design tool** — layers, selection, undo/redo stack, JSON export. Frontend-heavy.
5. **Event-sourced ledger** — append-only events, projections, replay to rebuild state (expenses or inventory).

Say “build the mini language in python” to start #1.

Testing stays idle until there are files to run.`,
    };
  }
  return {
    title: "Project ideas",
    reply: `Starter projects you can actually finish in this workspace — pick one and say “build this” or “write the frontend”. Want harder ones? Say **expert level**.

1. Personal dashboard — weather + notes, HTML/CSS/JS
2. Habit tracker — add/complete habits, save in localStorage
3. Expense splitter — people, amounts, who owes whom
4. Markdown notes page — edit on the left, preview on the right
5. Recipe box — search, ingredients list, “cook mode”

Testing stays idle for ideas. Once you choose one, Testing will smoke-check the app or UI — not DSA examples.`,
  };
}
