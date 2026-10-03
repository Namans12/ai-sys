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
  private static readonly maxScrapedSummaryCandidates = 5;
  private static readonly maxScrapedSummaryPoints = 3;
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
    const feedbackMemories = memories.filter(
      (memory) =>
        memory.metadata?.type === "feedback" && memory.metadata?.originalInput,
    );
    const matchedFeedback = feedbackMemories.find((memory) => {
      const original = String(memory.metadata?.originalInput).toLowerCase();
      const current = input.toLowerCase();

      return current === original;
    });
    const prioritizedMemories = this.prioritizeMemories(memories);

    if (matchedFeedback) {
      const improvement = this.getFeedbackImprovement(matchedFeedback);

      if (improvement === "ask_for_clarification") {
        return this.buildClarificationResponse();
      }
    }

    const relevantMemories = prioritizedMemories.slice(0, 3);
    const toolExecutor = this.toolExecutor;
    const scrapeUrl = this.extractUrl(input);

    if (this.shouldUseScrapeTool(input) && scrapeUrl && toolExecutor) {
      const toolResponse = await this.handleToolDecision(
        input,
        relevantMemories,
        toolExecutor,
        scrapeUrl,
      );

      if (toolResponse) {
        return toolResponse;
      }
    }

    const scrapedChunks = this.shouldUseScrapedChunks(input)
      ? this.getScrapedChunks(memories)
      : [];
    const decision = this.buildDecision(input, relevantMemories, scrapedChunks);

    if (decision.vagueScore >= 2) {
      return this.buildClarificationResponse();
    }

    if (
      decision.toolScore > Math.max(decision.memoryScore, decision.knowledgeScore)
    ) {
      const toolResponse = await this.handleToolDecision(
        input,
        relevantMemories,
        toolExecutor,
        scrapeUrl,
      );

      if (toolResponse) {
        return toolResponse;
      }
    }

    if (scrapedChunks.length > 0) {
      const response = this.buildScrapedDataResponse(scrapedChunks);
      return this.finalizeResponse(input, response);
    }

    const reasoning = this.buildMemoryReasoning(input, relevantMemories);
    const response = [
      `User asked: ${input}`,
      "Relevant memory:",
      this.formatMemories(relevantMemories),
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

    if (this.shouldUseScrapeTool(input)) {
      return false;
    }

    const normalizedInput = input.toLowerCase();
    const toolKeywords = ["echo", "calculate", "get"];

    return toolKeywords.some((keyword) => normalizedInput.includes(keyword));
  }

  private buildDecision(
    input: string,
    relevantMemories: MemoryEntry[],
    scrapedChunks: MemoryEntry[],
  ): {
    toolScore: number;
    memoryScore: number;
    knowledgeScore: number;
    vagueScore: number;
  } {
    return {
      toolScore: this.getToolScore(input),
      memoryScore: relevantMemories.length > 0 ? 1 : 0,
      knowledgeScore: scrapedChunks.length > 0 ? 1 : 0,
      vagueScore: this.getVagueScore(input),
    };
  }

  private getToolScore(input: string): number {
    const normalizedInput = input.toLowerCase();
    const toolKeywords = ["fetch", "get"];

    return toolKeywords.some((keyword) => normalizedInput.includes(keyword))
      ? 2
      : 0;
  }

  private getVagueScore(input: string): number {
    return input.split(" ").filter(Boolean).length < 3 ? 2 : 0;
  }

  private async handleToolDecision(
    input: string,
    relevantMemories: MemoryEntry[],
    toolExecutor: ToolExecutor | undefined,
    scrapeUrl: string | null,
  ): Promise<string | null> {
    if (!toolExecutor) {
      return null;
    }

    if (this.shouldUseScrapeTool(input) && scrapeUrl) {
      const scrapeResult = await toolExecutor.executeTool("scrape", {
        url: scrapeUrl,
      });
      const response = [
        `Scraped Title: ${this.getScrapeTitle(scrapeResult)}`,
        `Content Preview: ${this.getScrapePreview(scrapeResult)}`,
      ].join("\n");

      await this.storeScrapedChunks(scrapeUrl, scrapeResult);

      return this.finalizeResponse(input, response);
    }

    if (this.shouldUseTool(input)) {
      const toolResult = await toolExecutor.executeTool("echo", { input });
      const response = [
        `User asked: ${input}`,
        "Relevant memory:",
        this.formatMemories(relevantMemories),
        "Tool used: echo",
        `Tool result: ${this.formatToolResult(toolResult)}`,
        `Final Response: ${this.buildToolReasoning(input, relevantMemories)}`,
      ].join("\n");

      return this.finalizeResponse(input, response);
    }

    return null;
  }

  private shouldUseScrapeTool(input: string): boolean {
    const normalizedInput = input.toLowerCase();
    const scrapeKeywords = ["scrape", "fetch url", "get content from"];

    return scrapeKeywords.some((keyword) => normalizedInput.includes(keyword));
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

  private extractUrl(input: string): string | null {
    const match = input.match(/(https?:\/\/[^\s]+|data:[^\s]+)/i);

    if (!match) {
      return null;
    }

    return match[1].replace(/[)\].,!?;:]+$/, "");
  }

  private getScrapeTitle(result: unknown): string {
    const primaryPage = this.getPrimaryScrapedPage(result);

    if (primaryPage) {
      return primaryPage.title;
    }

    return "";
  }

  private getScrapePreview(result: unknown): string {
    const primaryPage = this.getPrimaryScrapedPage(result);

    if (!primaryPage) {
      return "";
    }

    return primaryPage.content.slice(0, 200);
  }

  private isScrapeResult(
    result: unknown,
  ): result is { pages: Array<{ title: string; content: string; url: string }> } {
    if (!result || typeof result !== "object") {
      return false;
    }

    const candidate = result as Record<string, unknown>;

    return (
      Array.isArray(candidate.pages) &&
      candidate.pages.every((page) => {
        if (!page || typeof page !== "object") {
          return false;
        }

        const pageRecord = page as Record<string, unknown>;

        return (
          typeof pageRecord.title === "string" &&
          typeof pageRecord.content === "string" &&
          typeof pageRecord.url === "string"
        );
      })
    );
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
      "Your input is unclear. Please provide more details.",
    ].join("\n");
  }

  private buildClarificationResponse(): string {
    return "Your input is unclear. Please provide more details so I can help effectively.";
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

  private async storeScrapedChunks(url: string, result: unknown): Promise<void> {
    if (!this.isScrapeResult(result)) {
      return;
    }

    for (const page of result.pages) {
      const chunks = this.chunkScrapedContent(page.content, page.title);

      for (const chunk of chunks) {
        await this.memory.store({
          content: chunk,
          metadata: {
            type: "scraped_chunk",
            url: page.url || url,
            title: page.title,
            topic: this.inferTopic(page.title, chunk),
            source: "multi_page",
          },
        });
      }
    }
  }

  private chunkScrapedContent(content: string, title: string): string[] {
    const normalizedContent = this.stripTitlePrefix(content, title)
      .replace(/\s+/g, " ")
      .trim();

    if (!normalizedContent) {
      return title ? [title] : [];
    }

    const sentences = normalizedContent
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length === 0) {
      return this.splitLongText(normalizedContent);
    }

    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
      const parts =
        sentence.length > 300 ? this.splitLongText(sentence) : [sentence];

      for (const part of parts) {
        const candidate = currentChunk ? `${currentChunk} ${part}` : part;

        if (candidate.length <= 300) {
          currentChunk = candidate;
          continue;
        }

        if (currentChunk) {
          chunks.push(currentChunk);
        }

        currentChunk = part;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return this.mergeSmallChunks(chunks);
  }

  private splitLongText(text: string): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const word of words) {
      const candidate = currentChunk ? `${currentChunk} ${word}` : word;

      if (candidate.length <= 280) {
        currentChunk = candidate;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      currentChunk = word;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private mergeSmallChunks(chunks: string[]): string[] {
    if (chunks.length <= 1) {
      return chunks;
    }

    const mergedChunks: string[] = [];

    for (const chunk of chunks) {
      const previousChunk = mergedChunks[mergedChunks.length - 1];

      if (
        previousChunk &&
        previousChunk.length < 200 &&
        `${previousChunk} ${chunk}`.length <= 300
      ) {
        mergedChunks[mergedChunks.length - 1] = `${previousChunk} ${chunk}`;
        continue;
      }

      mergedChunks.push(chunk);
    }

    return mergedChunks;
  }

  private getPrimaryScrapedPage(
    result: unknown,
  ): { title: string; content: string; url: string } | null {
    if (!this.isScrapeResult(result) || result.pages.length === 0) {
      return null;
    }

    return result.pages[0];
  }

  private getScrapedChunks(memories: MemoryEntry[]): MemoryEntry[] {
    return memories
      .filter((memory) => memory.metadata?.type === "scraped_chunk")
      .slice(0, MemoryAgentOrchestrator.maxScrapedSummaryCandidates);
  }

  private shouldUseScrapedChunks(input: string): boolean {
    return input.split(" ").filter(Boolean).length >= 3;
  }

  private buildScrapedDataResponse(scrapedChunks: MemoryEntry[]): string {
    const uniqueChunks = this.deduplicateScrapedChunks(scrapedChunks);
    const points = uniqueChunks
      .map((chunk) => this.summarizeChunk(chunk))
      .filter(Boolean)
      .slice(0, MemoryAgentOrchestrator.maxScrapedSummaryPoints)
      .map((summary) => `- ${summary}`);

    if (points.length === 0) {
      return "Based on scraped data:\n- No meaningful content available.";
    }

    return ["Based on scraped data:", ...points].join("\n");
  }

  private summarizeChunk(chunk: MemoryEntry): string {
    const title =
      typeof chunk.metadata?.title === "string" ? chunk.metadata.title : "";
    const normalizedContent = this.stripTitlePrefix(chunk.content, title)
      .replace(/\s+/g, " ")
      .trim();

    if (!normalizedContent) {
      return "";
    }

    const sentences = normalizedContent
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const strongSentence = sentences.find((sentence) =>
      this.isStrongSummarySentence(sentence),
    );

    if (strongSentence) {
      return strongSentence.slice(0, 200).trim();
    }

    const fallbackSentence = sentences.find((sentence) =>
      this.isMeaningfulSentence(sentence),
    );

    if (fallbackSentence) {
      return fallbackSentence.slice(0, 200).trim();
    }

    if (this.isMeaningfulSentence(normalizedContent)) {
      return normalizedContent.slice(0, 200).trim();
    }

    return "";
  }

  private deduplicateScrapedChunks(scrapedChunks: MemoryEntry[]): MemoryEntry[] {
    const uniqueChunks: MemoryEntry[] = [];

    for (const chunk of scrapedChunks) {
      const normalizedChunk = this.normalizeChunkForComparison(chunk.content);

      if (!normalizedChunk) {
        continue;
      }

      const isDuplicate = uniqueChunks.some((existingChunk) => {
        const normalizedExisting = this.normalizeChunkForComparison(
          existingChunk.content,
        );

        return (
          this.calculateChunkOverlap(normalizedChunk, normalizedExisting) > 0.7
        );
      });

      if (!isDuplicate) {
        uniqueChunks.push(chunk);
      }
    }

    return uniqueChunks;
  }

  private isStrongSummarySentence(sentence: string): boolean {
    return (
      this.isMeaningfulSentence(sentence) &&
      this.getWordCount(sentence) > 5 &&
      this.containsSummaryVerb(sentence)
    );
  }

  private isMeaningfulSentence(sentence: string): boolean {
    const normalizedSentence = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalizedSentence || this.isWeakSummaryText(normalizedSentence)) {
      return false;
    }

    const words = normalizedSentence.split(" ").filter(Boolean);

    if (words.length < 3) {
      return false;
    }

    const navigationWords = new Set([
      "account",
      "comment",
      "comments",
      "home",
      "login",
      "log",
      "menu",
      "navigation",
      "next",
      "previous",
      "reply",
      "search",
      "share",
      "sign",
      "submit",
    ]);

    const meaningfulWords = words.filter((word) => !navigationWords.has(word));

    return meaningfulWords.length >= 3;
  }

  private containsSummaryVerb(sentence: string): boolean {
    const summaryVerbs = new Set([
      "are",
      "describes",
      "explain",
      "explains",
      "help",
      "helps",
      "is",
      "means",
      "process",
      "processes",
      "provide",
      "provides",
      "report",
      "reports",
      "show",
      "shows",
      "support",
      "supports",
      "track",
      "tracks",
      "use",
      "used",
      "uses",
      "work",
      "works",
    ]);
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    return words.some((word) => summaryVerbs.has(word));
  }

  private getWordCount(sentence: string): number {
    return sentence.split(/\s+/).filter(Boolean).length;
  }

  private isWeakSummaryText(normalizedSentence: string): boolean {
    if (
      normalizedSentence === "learn more" ||
      normalizedSentence.startsWith("learn more ")
    ) {
      return true;
    }

    const weakPhrases = new Set([
      "back",
      "comments",
      "home",
      "learn",
      "login",
      "menu",
      "navigation",
      "next",
      "previous",
      "search",
      "share",
      "submit",
    ]);
    const words = normalizedSentence.split(" ").filter(Boolean);

    return words.length > 0 && words.every((word) => weakPhrases.has(word));
  }

  private normalizeChunkForComparison(content: string): string {
    return content.toLowerCase().replace(/\s+/g, "");
  }

  private calculateChunkOverlap(left: string, right: string): number {
    if (!left || !right) {
      return 0;
    }

    const shortestLength = Math.min(left.length, right.length);
    const longestSharedLength = this.getLongestCommonSubstringLength(left, right);

    return longestSharedLength / shortestLength;
  }

  private getLongestCommonSubstringLength(left: string, right: string): number {
    const matrix = Array.from({ length: left.length + 1 }, () =>
      new Array<number>(right.length + 1).fill(0),
    );
    let longest = 0;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      for (
        let rightIndex = 1;
        rightIndex <= right.length;
        rightIndex += 1
      ) {
        if (left[leftIndex - 1] !== right[rightIndex - 1]) {
          continue;
        }

        matrix[leftIndex][rightIndex] =
          matrix[leftIndex - 1][rightIndex - 1] + 1;
        longest = Math.max(longest, matrix[leftIndex][rightIndex]);
      }
    }

    return longest;
  }

  private stripTitlePrefix(content: string, title: string): string {
    const normalizedTitle = title.replace(/\s+/g, " ").trim();
    const normalizedContent = content.replace(/\s+/g, " ").trim();

    if (!normalizedTitle) {
      return normalizedContent;
    }

    if (!normalizedContent.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
      return normalizedContent;
    }

    return normalizedContent
      .slice(normalizedTitle.length)
      .replace(/^[-:|.\s]+/, "")
      .trim();
  }

  private prioritizeMemories(memories: MemoryEntry[]): MemoryEntry[] {
    const feedbackMemories = memories.filter(
      (memory) => memory.metadata?.type === "feedback",
    );

    if (feedbackMemories.length === 0) {
      return memories;
    }

    const nonFeedbackMemories = memories.filter(
      (memory) => memory.metadata?.type !== "feedback",
    );

    return [...feedbackMemories, ...nonFeedbackMemories];
  }

  private getFeedbackImprovement(memory: MemoryEntry): string | null {
    const improvement = memory.metadata?.improvement;
    return typeof improvement === "string" ? improvement : null;
  }

  private inferTopic(title: string, content: string): string {
    const searchableText = this.normalizeTopicText(`${title} ${content}`);

    if (
      this.containsTopicKeyword(searchableText, "ai") ||
      this.containsTopicKeyword(searchableText, "model") ||
      searchableText.includes("machine learning")
    ) {
      return "ai";
    }

    if (
      this.containsTopicKeyword(searchableText, "news") ||
      this.containsTopicKeyword(searchableText, "hn") ||
      this.containsTopicKeyword(searchableText, "article")
    ) {
      return "news";
    }

    if (
      this.containsTopicKeyword(searchableText, "code") ||
      this.containsTopicKeyword(searchableText, "function") ||
      this.containsTopicKeyword(searchableText, "typescript")
    ) {
      return "dev";
    }

    return "general";
  }

  private normalizeTopicText(value: string): string {
    return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  }

  private containsTopicKeyword(searchableText: string, keyword: string): boolean {
    return searchableText.includes(` ${keyword} `);
  }
}

export class PlaceholderAgentOrchestrator extends MemoryAgentOrchestrator {}
