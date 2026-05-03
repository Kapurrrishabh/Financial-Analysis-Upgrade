export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export const fetcher = (path: string) =>
  fetch(`${API_BASE}${path}`).then((res) => res.json());