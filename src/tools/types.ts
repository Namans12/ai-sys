export type ToolHandler = (input: any) => Promise<any>;

export interface ToolExecutor {
  registerTool(name: string, handler: ToolHandler): void;
  executeTool(name: string, input: any): Promise<any>;
}
