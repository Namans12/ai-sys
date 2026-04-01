import type {
  MemoryStore,
  MemoryEntry,
  MemoryStoreInput,
} from "./types";

export class InMemoryMemoryStore implements MemoryStore {
  // Entries are kept in process memory and live for the lifetime of this instance.
  private readonly entries: MemoryEntry[] = [];

  async store(input: MemoryStoreInput): Promise<void> {
    this.entries.push(this.cloneEntry(input));
  }

  async retrieve(query: string): Promise<MemoryEntry[]> {
    const normalizedQuery = this.normalizeText(query);

    // An empty query returns the current memory in insertion order.
    if (!normalizedQuery) {
      return this.entries.map((entry) => this.cloneEntry(entry));
    }

    const queryTerms = this.getTerms(normalizedQuery);

    return this.entries
      .map((entry, index) => ({
        entry,
        index,
        score: this.calculateScore(entry.content, normalizedQuery, queryTerms),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ entry }) => this.cloneEntry(entry));
  }

  // Relevance stays intentionally simple:
  // - exact query substring match gets a small boost
  // - each matched query term adds to the score
  private calculateScore(
    content: string,
    normalizedQuery: string,
    queryTerms: string[],
  ): number {
    const normalizedContent = this.normalizeText(content);

    if (!normalizedContent) {
      return 0;
    }

    let score = 0;

    if (normalizedContent.includes(normalizedQuery)) {
      score += Math.max(2, queryTerms.length);
    }

    for (const term of queryTerms) {
      if (normalizedContent.includes(term)) {
        score += 1;
      }
    }

    return score;
  }

  private getTerms(value: string): string[] {
    return value.split(/\s+/).filter(Boolean);
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  private cloneEntry(entry: MemoryEntry): MemoryEntry {
    return {
      content: entry.content,
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    };
  }
}

export class PlaceholderMemoryStore extends InMemoryMemoryStore {}
