"use strict";

const form = document.querySelector("form");
const statusLine = document.getElementById("compression-status");
const download = document.getElementById("compressed-download");
let resultUrl;

function clearResult() {
    download.hidden = true;
    download.removeAttribute("href");
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = undefined;
}

function formatBytes(bytes) {
    return bytes >= 1000000
        ? (bytes / 1000000).toFixed(2) + " MB"
        : bytes.toLocaleString() + " bytes";
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearResult();
    const data = new FormData(form);
    const file = data.get("files");
    const button = form.querySelector("button");
    button.disabled = true;
    statusLine.textContent = "Compressing…";
    try {
        const response = await fetch(form.action, {method: "POST", body: data, credentials: "same-origin"});
        if (!response.ok) {
            const errorPage = new DOMParser().parseFromString(await response.text(), "text/html");
            const message = errorPage.querySelector('[role="alert"]')?.textContent;
            throw new Error(message || "Compression failed (HTTP " + response.status + "). Reopen the tool and try again.");
        }
        if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf" ||
            !/^attachment;/i.test(response.headers.get("Content-Disposition") || "")) {
            throw new Error("The server returned a page instead of a PDF. Reopen the tool and try again.");
        }
        const pdf = await response.blob();
        if (await pdf.slice(0, 5).text() !== "%PDF-" || pdf.size >= file.size || !pdf.size) {
            throw new Error("The server did not return a smaller PDF. Keep your original file.");
        }
        const saved = (100 * (file.size - pdf.size) / file.size).toFixed(1);
        statusLine.textContent = formatBytes(file.size) + " → " + formatBytes(pdf.size) + " · " + saved + "% saved";
        resultUrl = URL.createObjectURL(pdf);
        download.href = resultUrl;
        download.hidden = false;
    } catch (error) {
        statusLine.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});
window.addEventListener("pagehide", clearResult);
