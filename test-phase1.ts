import { InMemoryMemoryStore } from "./src/memory/memory-store";
import { MemoryAgentOrchestrator } from "./src/agents/agent-orchestrator";
import { RegistryToolExecutor } from "./src/tools/tool-executor";
import { RuleBasedEvaluator } from "./src/evaluation/evaluator";
import { scrapeTool } from "./src/tools/scraper";

async function main() {
  const memory = new InMemoryMemoryStore();
  const tools = new RegistryToolExecutor();
  const evaluator = new RuleBasedEvaluator();

  tools.registerTool("scrape", scrapeTool);

  const agent = new MemoryAgentOrchestrator(
    memory,
    tools,
    evaluator
  );

  console.log("===== DEBUG: RAW SCRAPER OUTPUT =====");
  const raw = await scrapeTool({ url: "https://example.com" });
  console.log(JSON.stringify(raw, null, 2));

  console.log("===== STEP 1: SCRAPE =====");
  await agent.handle("scrape https://example.com");

  console.log("\n===== STEP 2: RAW MEMORY =====");
  const stored = await memory.retrieve("example");
  console.log(stored);

  console.log("\n===== STEP 3: QA (Before Dedup Fix) =====");
  const answer = await agent.handle("What is example domain?");
  console.log(answer);

  console.log("\n===== STEP 4: EDGE CASE (Short Input) =====");
  console.log(await agent.handle("hi"));

  console.log("\n===== STEP 5: LEARNING CHECK =====");
  console.log(await agent.handle("hi"));
}

main().catch(console.error);