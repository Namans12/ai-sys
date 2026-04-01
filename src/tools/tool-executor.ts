import type {
  ToolHandler,
  ToolExecutor,
} from "./types";

export class RegistryToolExecutor implements ToolExecutor {
  // Tools are stored in memory by name for direct lookup at execution time.
  private readonly tools = new Map<string, ToolHandler>();

  registerTool(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  async executeTool(name: string, input: any): Promise<any> {
    const handler = this.tools.get(name);

    if (!handler) {
      throw new Error(`Tool "${name}" is not registered.`);
    }

    return handler(input);
  }
}

export class PlaceholderToolExecutor extends RegistryToolExecutor {}
