import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// Include the upstream notices for modules shipped as JavaScript, CSS and worker assets.
export default defineConfig({
  base: "/static/ui/",
  resolve: { alias: { "@": path.resolve("src") } },
  build: {
    target: "es2022",
    rollupOptions: {
      input: path.resolve("src/main.tsx"),
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css")
            ? "app.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    {
      name: "distribution-notices",
      generateBundle(_, bundle) {
        const packages = new Set(["pdfjs-dist", "tailwindcss"]);
        for (const file of Object.values(bundle))
          if (file.type === "chunk") {
            for (const id of Object.keys(file.modules)) {
              const match = id
                .replaceAll("\\", "/")
                .match(/\/node_modules\/((?:@[^/]+\/)?[^/?]+)/);
              if (match) packages.add(match[1]);
            }
          }
        const texts: string[] = [];
        for (const pkg of [...packages].sort()) {
          const dir = path.join("node_modules", pkg);
          const licenses = fs
            .readdirSync(dir)
            .filter(
              (name) =>
                /^(license|licence|notice|copying)([.-]|$)/i.test(name) &&
                fs.statSync(path.join(dir, name)).isFile(),
            );
          if (!licenses.length)
            throw new Error("Missing license text for " + pkg);
          const version = JSON.parse(
            fs.readFileSync(path.join(dir, "package.json"), "utf8"),
          ).version;
          texts.push(
            pkg + " " + version,
            ...licenses.map((name) =>
              fs.readFileSync(path.join(dir, name), "utf8"),
            ),
          );
        }
        texts.push(fs.readFileSync("public/pdfjs-notices.txt", "utf8"));
        texts.push(
          "Inter, @fontsource-variable/inter 5.3.0",
          fs.readFileSync("public/inter-license.txt", "utf8"),
        );
        this.emitFile({
          type: "asset",
          fileName: "licenses.txt",
          source: texts.join("\n\n"),
        });
      },
    },
  ],
});
