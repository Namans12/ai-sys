import type {
  EvaluationResult,
  Evaluator,
} from "./types";

export class RuleBasedEvaluator implements Evaluator {
  async evaluate(output: string): Promise<EvaluationResult> {
    const normalizedOutput = output.trim();

    if (this.hasVagueInput(normalizedOutput)) {
      return {
        valid: false,
        feedback: "Input is too vague to produce meaningful output.",
      };
    }

    if (this.hasWeakReasoning(normalizedOutput)) {
      return {
        valid: false,
        feedback: "Response lacks meaningful reasoning.",
      };
    }

    // Empty output is always invalid because there is nothing useful to assess.
    if (!normalizedOutput) {
      return {
        valid: false,
        feedback: "Output is empty.",
      };
    }

    // Very short output is treated as insufficient for this simple evaluator.
    if (normalizedOutput.length < 10) {
      return {
        valid: false,
        feedback: "Output is too short.",
      };
    }

    return {
      valid: true,
    };
  }

  private hasVagueInput(output: string): boolean {
    return (
      output.includes("User asked: hi") ||
      output.includes("User asked: ok") ||
      output.includes("User asked: test")
    );
  }

  private hasWeakReasoning(output: string): boolean {
    if (!output.includes("The system found")) {
      return false;
    }

    const explanationWords = ["because", "works", "means", "helps"];
    const normalizedOutput = output.toLowerCase();

    return !explanationWords.some((word) => normalizedOutput.includes(word));
  }
}

export class PlaceholderEvaluator extends RuleBasedEvaluator {}
