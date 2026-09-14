/** `better-design` → `Better design`. For statuses, verdicts, stages and actions. */
export function label(value: string): string {
  const words = value.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
