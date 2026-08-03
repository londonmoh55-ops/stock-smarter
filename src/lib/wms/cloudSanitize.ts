import type { WmsState } from "./types";
import { uploadWarehousePhoto } from "./storageUpload";

const DATA_URL_RE = /^data:image\//i;
/** Stay under Firestore's 1 MiB doc limit with headroom for metadata. */
export const FIRESTORE_SAFE_BYTES = 900_000;
const PHOTO_UPLOAD_CONCURRENCY = 4;

function isInlineDataUrl(value: unknown): value is string {
  return typeof value === "string" && DATA_URL_RE.test(value);
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * Upload embedded Electron data-URL photos to Storage and replace with download URLs.
 * Keeps http(s) Storage URLs as-is. Uploads run with limited concurrency.
 */
export async function migrateInlinePhotosToStorage(
  state: WmsState,
  onProgress?: (done: number, total: number) => void,
): Promise<{ state: WmsState; uploaded: number }> {
  const next: WmsState = {
    ...state,
    preArrivalBons: state.preArrivalBons.map((b) => ({ ...b })),
    cargoBons: state.cargoBons.map((b) => ({ ...b })),
  };

  const jobs: Array<{ kind: "pre" | "cargo"; index: number; dataUrl: string }> = [];
  next.preArrivalBons.forEach((bon, index) => {
    if (isInlineDataUrl(bon.attachedPhoto)) {
      jobs.push({ kind: "pre", index, dataUrl: bon.attachedPhoto! });
    }
  });
  next.cargoBons.forEach((bon, index) => {
    if (isInlineDataUrl(bon.attachedPhoto)) {
      jobs.push({ kind: "cargo", index, dataUrl: bon.attachedPhoto! });
    }
  });

  if (jobs.length === 0) {
    return { state: next, uploaded: 0 };
  }

  let done = 0;
  await mapPool(jobs, PHOTO_UPLOAD_CONCURRENCY, async (job) => {
    const file = await dataUrlToFile(job.dataUrl, `${job.kind}-${job.index}.jpg`);
    const url = await uploadWarehousePhoto(file, "bons");
    if (job.kind === "pre") {
      next.preArrivalBons[job.index] = {
        ...next.preArrivalBons[job.index]!,
        attachedPhoto: url,
      };
    } else {
      next.cargoBons[job.index] = {
        ...next.cargoBons[job.index]!,
        attachedPhoto: url,
      };
    }
    done += 1;
    onProgress?.(done, jobs.length);
  });

  return { state: next, uploaded: jobs.length };
}

/** Drop any remaining data-URL photos so Firestore writes stay small. */
export function stripInlineDataUrlPhotos(state: WmsState): {
  state: WmsState;
  stripped: number;
} {
  let stripped = 0;
  const mapPhoto = <T extends { attachedPhoto?: string }>(bon: T): T => {
    if (!isInlineDataUrl(bon.attachedPhoto)) return bon;
    stripped += 1;
    return { ...bon, attachedPhoto: undefined };
  };
  return {
    state: {
      ...state,
      preArrivalBons: state.preArrivalBons.map(mapPhoto),
      cargoBons: state.cargoBons.map(mapPhoto),
    },
    stripped,
  };
}

export function countInlineDataUrlPhotos(state: WmsState): number {
  let n = 0;
  for (const bon of state.preArrivalBons) {
    if (isInlineDataUrl(bon.attachedPhoto)) n += 1;
  }
  for (const bon of state.cargoBons) {
    if (isInlineDataUrl(bon.attachedPhoto)) n += 1;
  }
  return n;
}

export function approxStateBytes(state: WmsState): number {
  return JSON.stringify(state).length;
}
