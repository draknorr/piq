import { PublisherIQError } from '@publisheriq/shared';

export class ContractRuntimeUnavailableError extends PublisherIQError {
  constructor(
    message: string,
    public readonly contractName: string,
    public readonly blockingTables: string[],
    context?: Record<string, unknown>
  ) {
    super(message, 'CONTRACT_RUNTIME_UNAVAILABLE', {
      ...context,
      blockingTables,
      contractName,
    });
    this.name = 'ContractRuntimeUnavailableError';
  }
}
