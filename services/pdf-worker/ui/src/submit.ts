import { root, type Tool } from "./catalog";

const mime: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export async function submit(
  tool: Tool,
  files: File[],
  option: string,
  settings: object,
) {
  const data = new FormData();
  data.set("csrf", root.dataset.csrf!);
  data.set("option", option);
  data.set("parameters", JSON.stringify(settings));
  for (const file of files) data.append("files", file);
  const response = await fetch("/tools/" + tool.slug, {
    method: "POST",
    body: data,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const html = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    throw new Error(
      html.querySelector('[role="alert"]')?.textContent ||
        "Processing failed (HTTP " + response.status + ").",
    );
  }
  let blob: Blob,
    name: string,
    summary = null;
  if (
    response.headers.get("Content-Type")?.startsWith("multipart/form-data;") &&
    ["compare", "sign"].includes(tool.id)
  ) {
    const parts = await response.formData();
    const file = parts.get("file");
    if (!(file instanceof File)) throw new Error("The report is missing.");
    blob = file;
    name = file.name;
    summary = JSON.parse(String(parts.get("summary")));
  } else {
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /^attachment;\s*filename="?([\w.-]+)"?$/i.exec(disposition);
    if (!match) throw new Error("The server did not return a download.");
    name = match[1];
    blob = await response.blob();
  }
  const ext = name.split(".").pop()!;
  if (!mime[ext] || blob.type.split(";")[0] !== mime[ext] || !blob.size)
    throw new Error("Unexpected download format.");
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const valid =
    ext === "pdf"
      ? String.fromCharCode(...header) === "%PDF-"
      : ext === "png"
        ? header[0] === 137 &&
          header[1] === 80 &&
          header[2] === 78 &&
          header[3] === 71
        : header[0] === 80 && header[1] === 75;
  if (!valid) throw new Error("The downloaded file is incomplete.");
  return { url: URL.createObjectURL(blob), name, size: blob.size, summary };
}
