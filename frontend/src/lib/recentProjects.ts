// "Most recently worked on" tracking. The backend orders projects by
// projects.updated_at, but that only changes when the project ROW changes — not
// when you actually work inside a project (scripts, scenes, sound, etc.). So we
// record when a project is opened, client-side, and rank by the freshest of
// (last-opened, server updated_at). This makes "featured" the easy hop-back.

const KEY = "toburt:recentProjects";

type OpenedMap = Record<string, number>; // projectId -> epoch ms

function read(): OpenedMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as OpenedMap;
  } catch {
    return {};
  }
}

/** Call when a project surface is opened (project overview, writers room, …). */
export function markProjectOpened(id: string | undefined | null): void {
  if (!id) return;
  try {
    const m = read();
    m[id] = Date.now();
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

type Rankable = { id: string; updated_at?: string };

function rank(p: Rankable, m: OpenedMap): number {
  const opened = m[p.id] ?? 0;
  const updated = p.updated_at ? Date.parse(p.updated_at) || 0 : 0;
  return Math.max(opened, updated);
}

/** Newest-worked-on first. Falls back to server updated_at for untracked ones. */
export function sortByRecent<T extends Rankable>(projects: T[]): T[] {
  const m = read();
  return [...projects].sort((a, b) => rank(b, m) - rank(a, m));
}

/** The project to feature / hop back into. */
export function pickFeatured<T extends Rankable>(projects: T[]): T | null {
  return sortByRecent(projects)[0] ?? null;
}
