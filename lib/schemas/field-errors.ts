// Maps Zod issues to a flat { field: firstMessage } map for server-action results. First message
// per top-level field wins, so the form shows one error per input. Shared by every server action.
export function fieldErrorsFrom(
  issues: { path: PropertyKey[]; message: string }[]
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}
