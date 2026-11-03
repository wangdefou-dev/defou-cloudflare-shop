type PublicDataPath = '/config' | '/regions';
declare global {
  interface Window {
    __orchardPublicData?: Partial<Record<PublicDataPath, Promise<unknown>>>;
  }
}

// Reuse the public requests started in <head>. A failed speculative request must
// fall back to the normal error-handled request; never include private endpoints.
export async function readPublicData(
  path: PublicDataPath,
  fallback: (path: string) => Promise<any>,
) {
  const pending = typeof window !== 'undefined' ? window.__orchardPublicData?.[path] : undefined;
  if (pending) {
    try {
      const value = await pending;
      if (value !== null && value !== undefined) return value;
    } catch {
      /* use the normal request and error handling */
    }
  }
  return fallback(path);
}
