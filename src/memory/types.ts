import type { Metadata } from "../types";

export interface MemoryEntry {
  content: string;
  metadata?: Metadata;
}

export type MemoryStoreInput = MemoryEntry;

export interface MemoryStore {
  store(input: MemoryStoreInput): Promise<void>;
  retrieve(query: string): Promise<MemoryEntry[]>;
}
