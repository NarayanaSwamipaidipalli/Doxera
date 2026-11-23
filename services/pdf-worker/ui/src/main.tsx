import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileCheck2 } from "lucide-react";
import HomePage from "./Home";
import { ToolPage } from "./ToolPage";
import { ThemeToggle } from "./components/ui/ThemeToggle";
import { tools, root } from "./catalog";
import "./app/globals.css";

function App() {
  const [slug, setSlug] = useState(root.dataset.slug || "");
  const [initial, setInitial] = useState<File>();
  const [error, setError] = useState("");
  useEffect(() => {
    const navigate = () => {
      setInitial(undefined);
      setError("");
      setSlug(location.pathname.split("/tools/")[1] || "");
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  const tool = tools.find((t) => t.slug === slug && t.available);
  function pick(file: File) {
    if (!file.size || file.size > 50_000_000 || !/\.pdf$/i.test(file.name)) {
      setError("Choose a PDF up to 50 MB.");
      return;
    }
    history.pushState(null, "", "/tools/compress-pdf");
    setInitial(file);
    setError("");
    setSlug("compress-pdf");
    window.scrollTo(0, 0);
  }
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/90 backdrop-blur-xl dark:border-white/[0.07] dark:bg-ink-950/90">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="focus-ring group flex items-center gap-2.5 rounded-lg"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-glow">
              <FileCheck2 className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight text-ink-900 dark:text-white">
              Doxera
            </span>
          </a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/#tools">PDF tools</a>
            <a href="#privacy">File privacy</a>
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <main>
        {error && (
          <p role="alert" className="mx-auto max-w-5xl p-3 text-rose-600">
            {error}
          </p>
        )}
        {tool ? (
          <ToolPage key={tool.slug} tool={tool} initial={initial} />
        ) : (
          <HomePage onPick={pick} />
        )}
      </main>
      <footer
        id="privacy"
        className="border-t border-black/10 px-4 py-10 dark:border-white/10"
      >
        <div className="mx-auto max-w-7xl space-y-2 text-sm">
          <h2 className="font-semibold">File privacy</h2>
          <p>
            Uploads and results are automatically deleted within one hour.
            Downloads stay on your device.
          </p>
          <p>We collect anonymous, cookie-free usage statistics.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center [&_a]:underline">
            {root.dataset.privacy && (
              <a href={"mailto:" + root.dataset.privacy}>
                {root.dataset.privacy}
              </a>
            )}
            {root.dataset.source && (
              <a href={root.dataset.source}>Source code for this version</a>
            )}
            <a href="/terms-and-privacy">Terms and privacy</a>
            <a href="/about">About</a>
            <a href="/static/ui/licenses.txt">Third-party notices</a>
            <small className="text-center text-xs text-ink-500 dark:text-zinc-400">
              Built by Narayana Swami Paidipalli and Potturi Naga Vydehi
            </small>
          </div>
        </div>
      </footer>
    </>
  );
}
root.className =
  "min-h-screen font-sans bg-[var(--background)] text-[var(--foreground)] selection:bg-brand-600 selection:text-white";
createRoot(root).render(<App />);
