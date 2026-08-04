export class OpportunityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityNotFoundError";
  }
}
