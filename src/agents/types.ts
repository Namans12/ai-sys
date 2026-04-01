export type AgentInput = string;

export type AgentOutput = string;

export interface AgentOrchestrator {
  handle(input: AgentInput): Promise<AgentOutput>;
}
