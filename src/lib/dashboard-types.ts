// Shapes for the admin dashboard: what the server assembles and the client
// renders and refetches. Plain data, importable from both sides.

export type DashboardPage = {
  id: string;
  route: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  sourceRepo: string | null;
  sourcePath: string | null;
  sourceCommit: string | null;
  /** Synced at the repo's current head. Null for pasted pages. */
  upToDate: boolean | null;
  fields: number;
  /** Image fields still showing the import placeholder (no upload yet). */
  placeholders: number;
  updatedAt: string;
};

export type DashboardProject = {
  owner: string;
  repo: string;
  fullName: string;
  branch: string;
  head: string | null;
  pushedAt: string | null;
  htmlUrl: string | null;
  /** Page files found in the repo (null when GitHub could not be reached). */
  pageFiles: number | null;
  imported: number;
  published: number;
  behind: number;
  /** Page files with no page yet, with the route they would get. */
  missing: Array<{ pagePath: string; route: string }>;
  /** Imported pages whose last sync predates the head commit. */
  outdated: Array<{ pagePath: string; route: string }>;
  lastSyncedAt: string | null;
  error: string | null;
};

export type DashboardData = {
  fetchedAt: string;
  github: { connected: boolean; error: string | null };
  stats: {
    pages: number;
    published: number;
    drafts: number;
    fields: number;
    media: number;
    placeholders: number;
    behind: number;
  };
  projects: DashboardProject[];
  pages: DashboardPage[];
};

export const dashboardQueryKey = ["dashboard"] as const;
