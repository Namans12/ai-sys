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

  console.log("===== TEST 1: Scrape Page =====");
  const scrapeResult = await agent.handle(
    "scrape https://example.com"
  );
  console.log(scrapeResult);

  console.log("\n===== TEST 2: Memory Storage Check =====");
  const stored = await memory.retrieve("example");
  console.log(stored);

  console.log("\n===== TEST 3: Retrieval QA =====");
  const answer = await agent.handle(
    "What is example domain?"
  );
  console.log(answer);

  console.log("\n===== TEST 4: Multi-page scrape =====");
  const multi = await agent.handle(
    "scrape https://news.ycombinator.com"
  );
  console.log(multi);

  console.log("\n===== TEST 5: Learning Loop =====");
  console.log(await agent.handle("hi")); // first time
  console.log(await agent.handle("hi")); // second time (should improve)
}

main().catch(console.error);