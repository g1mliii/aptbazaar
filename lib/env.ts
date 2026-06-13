export function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const appEnvironment =
  optionalEnv("NEXT_PUBLIC_APP_ENV") ?? optionalEnv("APP_ENV") ?? "development";

export const commitSha =
  optionalEnv("NEXT_PUBLIC_COMMIT_SHA") ??
  optionalEnv("CF_PAGES_COMMIT_SHA") ??
  optionalEnv("GITHUB_SHA") ??
  "local";

export const appVersion = optionalEnv("NEXT_PUBLIC_APP_VERSION") ?? "0.1.0";
