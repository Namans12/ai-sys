import type {
  MemoryStore,
  MemoryEntry,
  MemoryStoreInput,
} from "./types";

export class InMemoryMemoryStore implements MemoryStore {
  // Entries are kept in process memory and live for the lifetime of this instance.
  private readonly entries: MemoryEntry[] = [];
  private static readonly maxResults = 5;
  private static readonly topicBoost = 2;

  async store(input: MemoryStoreInput): Promise<void> {
    this.entries.push(this.cloneEntry(input));
  }

  async retrieve(query: string): Promise<MemoryEntry[]> {
    const normalizedQuery = this.normalizeText(query);
    const queryTerms = this.getTerms(normalizedQuery);
    const queryTopic = this.inferTopic(query);

    // An empty query returns the first few stored entries, with scraped chunks first.
    if (!normalizedQuery) {
      return this.entries
        .map((entry, index) => ({
          entry,
          index,
          typePriority: this.getTypePriority(entry),
        }))
        .sort(
          (left, right) =>
            right.typePriority - left.typePriority || left.index - right.index,
        )
        .slice(0, InMemoryMemoryStore.maxResults)
        .map(({ entry }) => this.cloneEntry(entry));
    }

    return this.entries
      .map((entry, index) => ({
        entry,
        index,
        score: this.calculateScore(entry, normalizedQuery, queryTerms, queryTopic),
        typePriority: this.getTypePriority(entry),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.typePriority - left.typePriority ||
          left.index - right.index,
      )
      .slice(0, InMemoryMemoryStore.maxResults)
      .map(({ entry }) => this.cloneEntry(entry));
  }

  // Relevance stays intentionally simple:
  // - token-level keyword matches add to the score
  // - a full query substring match gets an extra boost
  private calculateScore(
    entry: MemoryEntry,
    normalizedQuery: string,
    queryTerms: string[],
    queryTopic: string,
  ): number {
    const searchableText = this.getSearchableText(entry);

    if (!searchableText) {
      return 0;
    }

    let score = 0;

    if (searchableText.includes(normalizedQuery)) {
      score += Math.max(2, queryTerms.length);
    }

    const searchableTerms = this.getTerms(searchableText);

    for (const term of queryTerms) {
      score += searchableTerms.filter((candidate) => candidate === term).length;
    }

    if (this.getEntryTopic(entry) === queryTopic) {
      score += InMemoryMemoryStore.topicBoost;
    }

    return score;
  }

  private getSearchableText(entry: MemoryEntry): string {
    const title =
      typeof entry.metadata?.title === "string" ? entry.metadata.title : "";
    const combinedText = `${title} ${entry.content}`.trim();

    return this.normalizeText(combinedText);
  }

  private getTypePriority(entry: MemoryEntry): number {
    return entry.metadata?.type === "scraped_chunk" ? 1 : 0;
  }

  private getEntryTopic(entry: MemoryEntry): string {
    return typeof entry.metadata?.topic === "string"
      ? entry.metadata.topic
      : "general";
  }

  private getTerms(value: string): string[] {
    return value.split(/\s+/).filter(Boolean);
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  private inferTopic(query: string): string {
    const searchableText = this.normalizeTopicText(query);

    if (
      this.containsTopicKeyword(searchableText, "ai") ||
      this.containsTopicKeyword(searchableText, "model") ||
      searchableText.includes(" machine learning ")
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

  private cloneEntry(entry: MemoryEntry): MemoryEntry {
    return {
      content: entry.content,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    };
  }
}

export class PlaceholderMemoryStore extends InMemoryMemoryStore {}
