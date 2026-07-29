interface NetworkInformationLike {
  saveData?: boolean;
}

/** Pure predicate kept separate so reduced-data behavior is testable in Node. */
export function connectionPrefersReducedData(
  connection: NetworkInformationLike | undefined,
): boolean {
  return connection?.saveData === true;
}

/** Honor the browser's explicit reduced-data preference when it is available. */
export function prefersReducedData(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return connectionPrefersReducedData(connection);
}
