import { appEnvironment, appVersion, commitSha } from "./env";

export const version = {
  app: appVersion,
  commit: commitSha,
  environment: appEnvironment
};
