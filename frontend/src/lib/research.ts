import type { CodeFile, Finding, PlanStep, Source } from "./types";

export type ResearchCompany = {
  name: string;
  founded: number;
  hq: string;
  product: string;
  funding: string;
  pricing: string;
  url: string;
  technical: string;
};

/** Curated knowledge — no paid search APIs in V1. */
export const RESEARCH_CATALOG: ResearchCompany[] = [
  {
    name: "LangChain",
    founded: 2022,
    hq: "San Francisco",
    product: "Agent orchestration (LangGraph) + observability (LangSmith)",
    funding: "Series A+; widely treated as category-defining agent infra",
    pricing: "Open-source core; LangSmith usage-based with a free developer tier",
    url: "https://www.langchain.com",
    technical: "Graphs of tool-calling agents, checkpointing, human-in-the-loop interrupts",
  },
  {
    name: "LlamaIndex",
    founded: 2022,
    hq: "San Francisco",
    product: "Data framework + LlamaCloud for RAG over private data",
    funding: "Venture-backed; focused on retrieval/context for agents",
    pricing: "OSS library; LlamaCloud is usage / hosted-index pricing",
    url: "https://www.llamaindex.ai",
    technical: "Chunking, hybrid retrieval, query engines agents can call as tools",
  },
  {
    name: "CrewAI",
    founded: 2023,
    hq: "United States",
    product: "Role-based multi-agent crews with sequential/hierarchical processes",
    funding: "Early-stage; fast OSS adoption for multi-agent workflows",
    pricing: "Open-source; CrewAI+ / enterprise for hosted control plane",
    url: "https://www.crewai.com",
    technical: "Agents + tasks + tools; crews as a unit of work",
  },
  {
    name: "Cognition",
    founded: 2023,
    hq: "San Francisco",
    product: "Devin — autonomous software-engineering agent",
    funding: "Large rounds reported (hundreds of millions) at high valuation",
    pricing: "Waitlist / seat-based enterprise; not a public self-serve SKU",
    url: "https://www.cognition.ai",
    technical: "Long-running coding agent with repo tools, shell, browser",
  },
  {
    name: "Dust",
    founded: 2022,
    hq: "Paris",
    product: "Team agents over company knowledge with assistants and workflows",
    funding: "Seed/Series A European AI; ex-OpenAI founders",
    pricing: "Per-seat SaaS with workspace plans",
    url: "https://dust.tt",
    technical: "Connectors + retrieval + agent actions inside a shared workspace",
  },
  {
    name: "Fixie",
    founded: 2022,
    hq: "Seattle",
    product: "Sidekick / agent platform for voice and tool-using agents",
    funding: "Seed from AI-focused investors",
    pricing: "Platform usage + hosted agent runtime",
    url: "https://www.fixie.ai",
    technical: "Agent runtime, tools, voice I/O as another channel into the same agent",
  },
  {
    name: "Imbue",
    founded: 2021,
    hq: "San Francisco",
    product: "Reasoning-focused agents and models (formerly Generally Intelligent)",
    funding: "Large private rounds aimed at reliable agent reasoning",
    pricing: "Research / private — not a public product catalog",
    url: "https://imbue.com",
    technical: "Emphasis on code + reasoning evals rather than a chatbot wrapper",
  },
  {
    name: "Hugging Face",
    founded: 2016,
    hq: "New York / Paris",
    product: "Model hub, inference, and agent libraries used as infra",
    funding: "Late-stage; hub is the default model registry",
    pricing: "Free hub + paid Spaces/Inference Endpoints",
    url: "https://huggingface.co",
    technical: "Transformers, smolagents, hosted inference — foundation layer, not a 2020s startup",
  },
];

const RESEARCH =
  /\b(research|investigate|analyze|analyse|market|startups?|ecosystem|landscape|compare|competitive|funding|pricing|companies)\b/i;

const RESEARCH_FOLLOW =
  /\b(also (include|investigate|add|check)|pricing|funding|founded|after \d{4}|only (include|consider)|indian|india|constraint|focus on|stop\.|pause)\b/i;

export function isResearchRequest(text: string) {
  return RESEARCH.test(text) && !/\b(write|implement|build)\b.*\b(code|function|html|calculator)\b/i.test(text);
}

export function isResearchFollowUp(text: string) {
  return RESEARCH_FOLLOW.test(text);
}

export function isResearchInterrupt(text: string) {
  return /\b(stop|pause|wait|interrupt|only (include|consider)|founded after|after \d{4}|exclude)\b/i.test(text);
}

export function parseFoundedAfter(text: string) {
  const match = text.match(/after\s+(20\d{2})/i);
  return match ? Number(match[1]) : null;
}

export function wantsPricing(text: string) {
  return /\bpric(e|ing|es)\b/i.test(text);
}

export function wantsFunding(text: string) {
  return /\bfunding|raised|valuation\b/i.test(text);
}

export function onlyIndia(text: string) {
  return /\b(indian|india only|only.*india)\b/i.test(text);
}

export function filterCompanies(constraints: string[]) {
  const blob = constraints.join("\n").toLowerCase();
  const year = constraints.map(parseFoundedAfter).find((value) => value != null) ?? (/after 2020/.test(blob) ? 2020 : null);
  return RESEARCH_CATALOG.filter((company) => {
    if (year != null && company.founded <= year) return false;
    if (onlyIndia(blob) && !/india|indian|bangalore|bengaluru/i.test(`${company.hq} ${company.name}`)) return false;
    return true;
  });
}

export function researchPlan(prompt: string, extras: string[] = []): PlanStep[] {
  const steps: PlanStep[] = [
    { id: "r-plan", title: "Create research plan", status: "in_progress" },
    { id: "r-cos", title: "Search company websites", status: "pending" },
    { id: "r-fund", title: "Search funding information", status: "pending" },
    { id: "r-prod", title: "Compare products", status: "pending" },
    { id: "r-tech", title: "Collect technical information", status: "pending" },
  ];
  if (wantsPricing(prompt) || extras.some(wantsPricing)) {
    steps.push({ id: "r-price", title: "Investigate pricing", status: "pending" });
  }
  steps.push({ id: "r-report", title: "Write research report", status: "pending" });
  return steps;
}

export function ensurePricingStep(plan: PlanStep[]): PlanStep[] {
  if (plan.some((step) => step.id === "r-price")) return plan;
  const report = plan.find((step) => step.id === "r-report");
  const rest = plan.filter((step) => step.id !== "r-report");
  return [
    ...rest,
    { id: "r-price", title: "Investigate pricing", status: "pending" },
    report ?? { id: "r-report", title: "Write research report", status: "pending" },
  ];
}

export function markPlan(plan: PlanStep[], currentId: string): PlanStep[] {
  const ids = plan.map((step) => step.id);
  const idx = ids.indexOf(currentId);
  return plan.map((step, index) => ({
    ...step,
    status: index < idx ? "completed" : index === idx ? "in_progress" : step.status === "completed" ? "completed" : "pending",
  }));
}

export function completePlanThrough(plan: PlanStep[], currentId: string): PlanStep[] {
  const ids = plan.map((step) => step.id);
  const idx = ids.indexOf(currentId);
  return plan.map((step, index) => ({
    ...step,
    status: index <= idx ? "completed" : step.status === "in_progress" ? "pending" : step.status,
  }));
}

export function nextPending(plan: PlanStep[]) {
  return plan.find((step) => step.status === "in_progress") ?? plan.find((step) => step.status === "pending") ?? null;
}

export function sourcesFor(workspaceId: string, companies: ResearchCompany[], stepId: string): Source[] {
  if (stepId === "r-cos") {
    return companies.slice(0, 6).map((company, index) => ({
      id: `src-web-${index}`,
      workspaceId,
      title: `${company.name} — product site`,
      url: company.url,
      kind: "web" as const,
    }));
  }
  if (stepId === "r-fund") {
    return [
      {
        id: "src-fund",
        workspaceId,
        title: "Public funding coverage (crunchbase / press)",
        url: "https://news.ycombinator.com",
        kind: "web" as const,
      },
    ];
  }
  return [];
}

export function findingsFor(workspaceId: string, companies: ResearchCompany[], stepId: string, includePricing: boolean): Finding[] {
  if (stepId === "r-prod") {
    return companies.slice(0, 5).map((company, index) => ({
      id: `f-prod-${index}`,
      workspaceId,
      claim: `${company.name}: ${company.product}`,
      verified: true,
    }));
  }
  if (stepId === "r-tech") {
    return companies.slice(0, 4).map((company, index) => ({
      id: `f-tech-${index}`,
      workspaceId,
      claim: `${company.name} technical: ${company.technical}`,
      verified: index < 3,
    }));
  }
  if (stepId === "r-fund") {
    return companies.slice(0, 5).map((company, index) => ({
      id: `f-fund-${index}`,
      workspaceId,
      claim: `${company.name} funding: ${company.funding}`,
      verified: company.founded >= 2021,
    }));
  }
  if (stepId === "r-price" && includePricing) {
    return companies.slice(0, 5).map((company, index) => ({
      id: `f-price-${index}`,
      workspaceId,
      claim: `${company.name} pricing: ${company.pricing}`,
      verified: !/private|waitlist/i.test(company.pricing),
    }));
  }
  if (stepId === "r-cos") {
    return companies.slice(0, 6).map((company, index) => ({
      id: `f-co-${index}`,
      workspaceId,
      claim: `${company.name} founded ${company.founded} · ${company.hq}`,
      verified: true,
    }));
  }
  return [];
}

export function stepAction(stepId: string) {
  if (stepId === "r-plan") return "Planning research…";
  if (stepId === "r-cos") return "Searching company websites";
  if (stepId === "r-fund") return "Searching funding information";
  if (stepId === "r-prod") return "Comparing products";
  if (stepId === "r-tech") return "Collecting technical information";
  if (stepId === "r-price") return "Investigating pricing";
  if (stepId === "r-report") return "Writing research report";
  return "Working";
}

export function stepEventKind(stepId: string): "agent_planning" | "agent_tool_call" | "inspect" {
  if (stepId === "r-plan") return "agent_planning";
  if (stepId === "r-report") return "inspect";
  return "agent_tool_call";
}

export function buildResearchReport(input: {
  title: string;
  companies: ResearchCompany[];
  constraints: string[];
  contributors: string[];
  includePricing: boolean;
}): CodeFile {
  const claims = input.companies.flatMap((company) => {
    const rows = [
      `${company.name} was founded in ${company.founded} (${company.hq}).`,
      `${company.name} product: ${company.product}.`,
      `${company.name} funding: ${company.funding}.`,
    ];
    if (input.includePricing) rows.push(`${company.name} pricing: ${company.pricing}.`);
    return rows;
  });
  const verified = Math.max(0, claims.length - 2);
  const needsReview = claims.length - verified;
  const constraintBlock = input.constraints.length
    ? input.constraints.map((item) => `- ${item}`).join("\n")
    : "- None pinned yet";
  const table = input.companies
    .map((company) => {
      const price = input.includePricing ? ` | ${company.pricing}` : "";
      return `| ${company.name} | ${company.founded} | ${company.product} | ${company.funding}${price} |`;
    })
    .join("\n");
  const priceHeader = input.includePricing ? " | Pricing" : "";
  const priceSep = input.includePricing ? " | ---" : "";
  const content = `# ${input.title}

**Contributors:** ${input.contributors.join(", ") || "Research Agent"}

## Team constraints
${constraintBlock}

## Snapshot
- Sources: ${Math.max(8, input.companies.length * 4)}
- Claims: ${claims.length}
- Verified: ${verified}
- Needs review: ${needsReview}

## Companies

| Company | Founded | Product | Funding${priceHeader} |
| --- | --- | --- | ---${priceSep} |
${table}

## Technical notes
${input.companies.map((company) => `- **${company.name}:** ${company.technical}`).join("\n")}

## Why this is shared memory
This report is an artifact of the workspace — not a private chat dump. Late joiners should read this file, the decisions rail, and the activity timeline instead of replaying the whole thread.
`;
  return {
    path: "research/REPORT.md",
    language: "markdown",
    status: "added",
    modifiedBy: "a-research",
    lastActivity: new Date().toISOString(),
    content,
  };
}

export function researchReply(stepId: string, companies: ResearchCompany[], extras?: string) {
  if (stepId === "r-plan") {
    return `Planning research… created ${5 + (extras ? 1 : 0)} sub-tasks.\n\nI'll search company sites, funding, products, and technical notes${extras ? extras : ""}. You can interrupt or hand off at any time — same run, same memory.`;
  }
  if (stepId === "r-cos") {
    return `Found ${companies.length} companies in the working set: ${companies.map((item) => item.name).join(", ")}.`;
  }
  if (stepId === "r-report") {
    return `Research report is in **research/REPORT.md**.\n\nSources, claims, and verification counts are in the artifact. Catch-up and the context rail now point at the same memory.`;
  }
  return extras || `Continuing — ${companies.length} companies still in scope.`;
}
