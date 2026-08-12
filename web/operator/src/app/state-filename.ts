/** Mirrors savedStateFilename in src/core/state.ts, which the hub uses too. */
export function savedStateFilename(at: Date): string {
  return `videoreferee-${at.toISOString().replace(/[:.]/g, '-')}.json`;
}
