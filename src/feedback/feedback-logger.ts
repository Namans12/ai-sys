import type {
  FeedbackLogger,
  FeedbackLogInput,
} from "./types";

export class InMemoryFeedbackLogger implements FeedbackLogger {
  // Feedback stays in process memory for the lifetime of this logger instance.
  private readonly feedbackEntries: FeedbackLogInput[] = [];

  async log(input: FeedbackLogInput): Promise<void> {
    this.feedbackEntries.push(this.cloneEntry(input));
  }

  getFeedback(): FeedbackLogInput[] {
    return this.feedbackEntries.map((entry) => this.cloneEntry(entry));
  }

  private cloneEntry(entry: FeedbackLogInput): FeedbackLogInput {
    return {
      userInput: entry.userInput,
      output: entry.output,
      feedback: entry.feedback,
    };
  }
}

export class PlaceholderFeedbackLogger extends InMemoryFeedbackLogger {}
