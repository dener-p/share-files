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

  // Translation helper; strings live in /i18n.js.
  const tr = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key);

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
  const refs = {};

  function ghostButton(label, act) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-ghost";
    b.textContent = label;
    b.dataset.act = act;
    return b;
  }

  // Re-translate the modal when the language changes (and while it is open).
  function retranslate() {
    if (!backdrop) return;
    refs.title.textContent = tr("report.title");
    refs.hint.textContent = tr("report.hint", { handle: DISCORD_HANDLE });
    refs.reportEl.setAttribute("aria-label", tr("report.aria"));
    refs.copyReport.textContent = tr("report.copyReport");
    refs.copyHandle.textContent = tr("report.copyHandle", { handle: DISCORD_HANDLE });
    refs.openIssue.textContent = tr("report.openIssue");
    refs.close.textContent = tr("report.close");
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
    title.textContent = tr("report.title");
    refs.title = title;

    const hint = document.createElement("p");
    hint.className = "qr-hint";
    hint.textContent = tr("report.hint", { handle: DISCORD_HANDLE });
    refs.hint = hint;

    reportEl = document.createElement("textarea");
    reportEl.className = "report-text";
    reportEl.readOnly = true;
    reportEl.spellcheck = false;
    reportEl.setAttribute("aria-label", tr("report.aria"));
    refs.reportEl = reportEl;

    const row1 = document.createElement("div");
    row1.className = "qr-actions report-row";
    const copyReport = ghostButton(tr("report.copyReport"), "copy-report");
    const copyHandle = ghostButton(tr("report.copyHandle", { handle: DISCORD_HANDLE }), "copy-handle");
    refs.copyReport = copyReport;
    refs.copyHandle = copyHandle;
    row1.append(copyReport, copyHandle);

    const issues = document.createElement("a");
    issues.className = "btn-ghost report-link";
    issues.href = GITHUB_ISSUES;
    issues.target = "_blank";
    issues.rel = "noopener noreferrer";
    issues.textContent = tr("report.openIssue");
    refs.openIssue = issues;

    const closeBtn = ghostButton(tr("report.close"), "close");
    refs.close = closeBtn;

    const row2 = document.createElement("div");
    row2.className = "qr-actions report-row";
    row2.append(issues, closeBtn);

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
      el.textContent = tr("report.copied");
      el.classList.add("copied");
      setTimeout(() => {
        el.textContent = previous;
        el.classList.remove("copied");
      }, 1600);
    });

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !backdrop.hidden) close(); });
    document.addEventListener("i18n:change", retranslate);
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
