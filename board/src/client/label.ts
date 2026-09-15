/** `better-design` → `Better Design`. For statuses, verdicts, stages and actions. */
export function label(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
