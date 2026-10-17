// "Report a bug" flow. Any element with data-report-bug opens it. It gathers a
// little context (plus diagnostics when app.js exposes them), copies everything
// to the clipboard and explains how to reach the maintainer. Discord cannot be
// linked by username, so the report is copied and the handle is offered for a
// DM instead. Adapted from Golive's report.js.
(function () {
  "use strict";

  // ---- Configure these for this project ----
  const GITHUB_REPO = "https://github.com/dener-p/share-files";
  const DISCORD_HANDLE = "zen.kye";
  const APP_NAME = "Share Files";
  // ------------------------------------------

  const GITHUB_ISSUES = `${GITHUB_REPO}/issues/new`;

  // The deployed version is injected into <meta name="share-version"> by the
  // Worker from the APP_VERSION var in wrangler.jsonc.
  function appVersion() {
    const meta = document.querySelector('meta[name="share-version"]');
    const v = meta && meta.getAttribute("content");
    return v && v !== "__APP_VERSION__" ? v.trim() : "";
  }

  function buildReport() {
    const lines = [`${APP_NAME} bug report`];
    const version = appVersion();
    if (version) lines.push(`version: ${version}`);
    lines.push(`page: ${location.href}`);
    lines.push(`lang: ${document.documentElement.lang || "-"}`);
    let diag = "";
    if (typeof window.shareDiagnostics === "function") {
      try { diag = window.shareDiagnostics() || ""; } catch { diag = ""; }
    }
    if (diag) {
      lines.push("", diag);
    } else {
      lines.push(`time: ${new Date().toISOString()}`);
      lines.push(`ua: ${navigator.userAgent}`);
    }
    return lines.join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  let backdrop = null;
  let reportEl = null;
  let lastFocus = null;

  function ghostButton(label, act) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-ghost";
    b.textContent = label;
    b.dataset.act = act;
    return b;
  }

  function buildModal() {
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.hidden = true;

    const box = document.createElement("div");
    box.className = "modal report-modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "reportTitle");

    const title = document.createElement("h2");
    title.id = "reportTitle";
    title.textContent = "Report a bug";

    const hint = document.createElement("p");
    hint.className = "qr-hint";
    hint.textContent = `Copy this report and send it to @${DISCORD_HANDLE} on Discord, or open an issue.`;

    reportEl = document.createElement("textarea");
    reportEl.className = "report-text";
    reportEl.readOnly = true;
    reportEl.spellcheck = false;
    reportEl.setAttribute("aria-label", "Bug report");

    const row1 = document.createElement("div");
    row1.className = "qr-actions report-row";
    row1.append(
      ghostButton("Copy report", "copy-report"),
      ghostButton(`Copy @${DISCORD_HANDLE}`, "copy-handle"),
    );

    const issues = document.createElement("a");
    issues.className = "btn-ghost report-link";
    issues.href = GITHUB_ISSUES;
    issues.target = "_blank";
    issues.rel = "noopener noreferrer";
    issues.textContent = "Open an issue";

    const row2 = document.createElement("div");
    row2.className = "qr-actions report-row";
    row2.append(issues, ghostButton("Close", "close"));

    box.append(title, hint, reportEl, row1, row2);
    backdrop.append(box);

    box.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "close") {
        close();
        return;
      }
      const text = act === "copy-report" ? reportEl.value : `@${DISCORD_HANDLE}`;
      const ok = await copyText(text);
      if (!ok) {
        reportEl.focus();
        reportEl.select();
        return;
      }
      const previous = el.textContent;
      el.textContent = "Copied";
      el.classList.add("copied");
      setTimeout(() => {
        el.textContent = previous;
        el.classList.remove("copied");
      }, 1600);
    });

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });
    return backdrop;
  }

  function open(text) {
    const el = buildModal();
    reportEl.value = text;
    reportEl.scrollTop = 0;
    lastFocus = document.activeElement;
    el.hidden = false;
    reportEl.focus();
  }

  function close() {
    if (!backdrop) return;
    backdrop.hidden = true;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function wire() {
    document.querySelectorAll("[data-report-bug]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.preventDefault();
        const text = buildReport();
        const ok = await copyText(text);
        open(text);
        if (!ok) {
          reportEl.select();
        }
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
