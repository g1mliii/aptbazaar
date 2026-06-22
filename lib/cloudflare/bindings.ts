import { getCloudflareContext } from "@opennextjs/cloudflare";

// Minimal binding shapes (avoids a hard dep on @cloudflare/workers-types). The edge only needs
// to PUT pending bytes into R2 and enqueue a job; reading/cleaning happens in the container worker.

export interface R2PutOptions {
  httpMetadata?: { contentType?: string; cacheControl?: string };
  customMetadata?: Record<string, string>;
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface Queue<Body = unknown> {
  send(body: Body, options?: { contentType?: string }): Promise<unknown>;
}

/** R2 bucket holding seller uploads (pending + cleaned). Null outside the Worker runtime. */
export function getUploadsBucket(): R2Bucket | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { UPLOADS_BUCKET?: R2Bucket }).UPLOADS_BUCKET ?? null;
  } catch {
    return null;
  }
}

/** Producer side of the image-processing queue. Null outside the Worker runtime. */
export function getImageQueue(): Queue | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { IMAGE_QUEUE?: Queue }).IMAGE_QUEUE ?? null;
  } catch {
    return null;
  }
}
