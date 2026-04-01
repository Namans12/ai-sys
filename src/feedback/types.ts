export interface FeedbackLogInput {
  userInput: string;
  output: string;
  feedback: string;
}

export interface FeedbackLogger {
  log(input: FeedbackLogInput): Promise<void>;
  getFeedback(): FeedbackLogInput[];
}
