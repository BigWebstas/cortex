export function auditLock(lock: object, root: string): string[]
export function auditComponents(
  lock: object,
  root: string,
  exceptions: Array<{ path: string; reason: string; reference: string }>,
): string[]
