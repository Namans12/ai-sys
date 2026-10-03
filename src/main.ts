import { InMemoryMemoryStore } from "./memory/memory-store";
import { MemoryAgentOrchestrator } from "./agents/agent-orchestrator";
import { RegistryToolExecutor } from "./tools/tool-executor";
import { RuleBasedEvaluator } from "./evaluation/evaluator"; // ✅ add this
import { scrapeTool } from "./tools/scraper";
import type { MemoryEntry, MemoryStore } from "./memory/types";
import type { AgentOrchestrator } from "./agents/types";
import type { ToolExecutor } from "./tools/types";

async function main(): Promise<void> {
  const memoryStore: MemoryStore = new InMemoryMemoryStore();
  const toolExecutor: ToolExecutor = new RegistryToolExecutor();
  const evaluator = new RuleBasedEvaluator(); // ✅ add this

  toolExecutor.registerTool("echo", async (input: any) => input);
  toolExecutor.registerTool("scrape", scrapeTool);

  const agent: AgentOrchestrator = new MemoryAgentOrchestrator(
    memoryStore,
    toolExecutor,
    evaluator // ✅ inject here
  );

  const entries: MemoryEntry[] = [
    {
      content: "The memory module stores observations from the AI loop.",
      metadata: { topic: "memory", priority: 1 },
    },
    {
      content: "The agent decides which tool to call based on the current task.",
      metadata: { topic: "agent", priority: 2 },
    },
    {
      content: "Memory retrieval should rank relevant entries before less relevant ones.",
      metadata: { topic: "memory", priority: 3 },
    },
    {
      content: "Evaluation checks whether the output is valid and useful.",
      metadata: { topic: "evaluation", priority: 4 },
    },
    {
      content: "Short-term memory helps the system keep track of recent context.",
      metadata: { topic: "memory", priority: 5 },
    },
  ];

  for (const entry of entries) {
    await memoryStore.store(entry);
  }

  const scrapeResponse = await agent.handle(
  "scrape https://example.com"
  );

  console.log("");
  console.log("Scrape response:");
  console.log(scrapeResponse);

  const memoryResponse = await agent.handle("How does memory work?");
  const toolResponse = await agent.handle("echo hello world");

  console.log("Memory response:");
  console.log(memoryResponse);
  console.log("");

  console.log("Tool response:");
  console.log(toolResponse);
  
  console.log("");
  console.log("Short input response:");
  const shortResponse = await agent.handle("hi");
  console.log(shortResponse);
}

void main().catch((error: unknown) => {
  console.error("Agent demo failed.", error);
});