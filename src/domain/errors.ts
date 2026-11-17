// Shared error type for business-rule violations. UI maps `code` to a message; services never format UI text.
export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'DomainError'; }
}
export function assertDomain(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) throw new DomainError(code, message);
}
