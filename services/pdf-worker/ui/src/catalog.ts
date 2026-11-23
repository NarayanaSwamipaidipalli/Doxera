import entries from "./lib/tools.json";

export const root = document.getElementById("app")!;
const limits: Record<
  string,
  { min: number; max: number; extensions: string[] }
> = JSON.parse(root.dataset.limits!);
const coming: string[] = JSON.parse(root.dataset.coming!);
export const tools = entries.map((entry) => {
  const limit = limits[entry.slug];
  const extensions = entry.id === "sign" ? ["pdf"] : (limit?.extensions ?? []);
  const max = entry.id === "sign" ? 1 : (limit?.max ?? 0);
  return {
    ...entry,
    available: Boolean(limit),
    status: coming.includes(entry.slug) ? "Coming soon" : "Unavailable",
    min: limit?.min ?? 0,
    max,
    multipleFiles: max > 1,
    acceptedTypes: extensions.map((ext) => "." + ext),
  };
});
export type Tool = (typeof tools)[number];

export const workingTools = tools.filter((tool) => tool.enabled && tool.available);
export const comingSoonTools = tools
  .filter((tool) => tool.enabled && !tool.available && tool.status === "Coming soon")
  .slice(0, 4);
