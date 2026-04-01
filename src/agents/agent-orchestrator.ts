import type {
  AgentInput,
  AgentOutput,
  AgentOrchestrator,
} from "./types";
import type { MemoryEntry, MemoryStore } from "../memory/types";
import type { ToolExecutor } from "../tools/types";
import type { Evaluator } from "../evaluation/types";
import type { FeedbackLogger } from "../feedback/types";

export class MemoryAgentOrchestrator implements AgentOrchestrator {
  private readonly memory: MemoryStore;
  private readonly toolExecutor?: ToolExecutor;
  private readonly evaluator?: Evaluator;
  private readonly feedbackLogger?: FeedbackLogger;

  constructor(
    memory: MemoryStore,
    toolExecutor?: ToolExecutor,
    evaluator?: Evaluator,
    feedbackLogger?: FeedbackLogger,
  ) {
    this.memory = memory;
    this.toolExecutor = toolExecutor;
    this.evaluator = evaluator;
    this.feedbackLogger = feedbackLogger;
  }

  async handle(input: AgentInput): Promise<AgentOutput> {
    // Memory is always retrieved first so every response can use stored context.
    const memories = await this.memory.retrieve(input);
    const feedbackMemory = memories.find((memory) =>
      this.isRelatedFeedbackMemory(memory, input),
    );

    if (feedbackMemory) {
      const improvement = this.getFeedbackImprovement(feedbackMemory);

      if (improvement === "ask_for_clarification") {
        return this.finalizeResponse(
          input,
          "Your input is unclear. Please provide more details so I can help effectively.",
        );
      }

      return this.finalizeResponse(
        input,
        "Your input seems vague. Please provide more details.",
      );
    }

    const relevantMemories = memories.slice(0, 3);
    const formattedMemories = this.formatMemories(relevantMemories);
    const toolExecutor = this.toolExecutor;

    if (toolExecutor && this.shouldUseTool(input)) {
      const toolResult = await toolExecutor.executeTool("echo", { input });
      const reasoning = this.buildToolReasoning(input, relevantMemories);
      const response = [
        `User asked: ${input}`,
        "Relevant memory:",
        formattedMemories,
        "Tool used: echo",
        `Tool result: ${this.formatToolResult(toolResult)}`,
        `Final Response: ${reasoning}`,
      ].join("\n");

      return this.finalizeResponse(input, response);
    }

    const reasoning = this.buildMemoryReasoning(input, relevantMemories);
    const response = [
      `User asked: ${input}`,
      "Relevant memory:",
      formattedMemories,
      `Response: ${reasoning}`,
    ].join("\n");

    return this.finalizeResponse(input, response);
  }

  // Tool usage is intentionally simple and deterministic:
  // - only enabled when a tool executor exists
  // - only triggered by a fixed set of keywords
  private shouldUseTool(input: string): boolean {
    if (!this.toolExecutor) {
      return false;
    }

    const normalizedInput = input.toLowerCase();
    const toolKeywords = ["echo", "calculate", "get"];

    return toolKeywords.some((keyword) => normalizedInput.includes(keyword));
  }

  private buildToolReasoning(input: string, memories: MemoryEntry[]): string {
    if (memories.length === 0) {
      return `The tool was used for "${input}" because the input matched a tool keyword, and no relevant memory was available.`;
    }

    return `The tool was used for "${input}" and the ${memories.length} retrieved memory item(s) provide supporting context for the final response.`;
  }

  private buildMemoryReasoning(input: string, memories: MemoryEntry[]): string {
    if (memories.length === 0) {
      return `No relevant memory was found for "${input}", so the system should continue using only the current input.`;
    }

    return `The system found ${memories.length} relevant memory item(s) and should use them as supporting context for "${input}".`;
  }

  private formatMemories(memories: MemoryEntry[]): string {
    if (memories.length === 0) {
      return "None";
    }

    return memories
      .map((memory, index) => `${index + 1}. ${memory.content}`)
      .join("\n");
  }

  private formatToolResult(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }

    return JSON.stringify(result);
  }

  // Evaluation runs once after the response is created.
  // If the response is invalid, a deterministic clarification is appended.
  private async finalizeResponse(input: string, response: string): Promise<string> {
    const evaluator = this.evaluator;

    if (!evaluator) {
      return response;
    }

    const result = await evaluator.evaluate(response);

    if (result.valid) {
      return response;
    }

    const feedback = result.feedback ?? "Response did not pass evaluation.";
    const feedbackLogger = this.feedbackLogger;

    if (feedbackLogger) {
      await feedbackLogger.log({
        userInput: input,
        output: response,
        feedback,
      });
    }

    await this.memory.store(this.buildFeedbackMemory(input));

    const adjustedResponse = this.buildAdjustedResponse(response);

    return [
      response,
      `Evaluation Feedback: ${feedback}`,
      `Adjusted Response: ${adjustedResponse}`,
    ].join("\n");
  }

  private buildAdjustedResponse(response: string): string {
    return [
      response,
      "Clarification: Additional detail was appended after evaluation to make the response more complete.",
    ].join("\n");
  }

  private buildFeedbackMemory(input: string): MemoryEntry {
    return {
      content: `User input '${input}' was too vague. Suggested improvement: ask for clarification.`,
      metadata: {
        type: "feedback",
        originalInput: input,
        improvement: "ask_for_clarification",
      },
    };
  }

  private isRelatedFeedbackMemory(memory: MemoryEntry, input: string): boolean {
    const metadata = memory.metadata;

    if (!metadata || metadata.type !== "feedback") {
      return false;
    }

    const originalInput =
      typeof metadata.originalInput === "string" ? metadata.originalInput : "";

    if (!originalInput) {
      return false;
    }

    const normalizedInput = this.normalizeText(input);
    const normalizedOriginalInput = this.normalizeText(originalInput);

    return (
      normalizedInput === normalizedOriginalInput ||
      normalizedInput.includes(normalizedOriginalInput) ||
      normalizedOriginalInput.includes(normalizedInput)
    );
  }

  private getFeedbackImprovement(memory: MemoryEntry): string | null {
    const improvement = memory.metadata?.improvement;
    return typeof improvement === "string" ? improvement : null;
  }

  private normalizeText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim();
  }
}

export class PlaceholderAgentOrchestrator extends MemoryAgentOrchestrator {}
