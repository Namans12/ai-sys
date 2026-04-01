export interface EvaluationResult {
  valid: boolean;
  feedback?: string;
}

export interface Evaluator {
  evaluate(output: string): Promise<EvaluationResult>;
}
