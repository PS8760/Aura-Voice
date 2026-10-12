/** Tiny class-name joiner. Avoids pulling in a dependency for two lines. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
