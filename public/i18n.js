// Minimal two-language UI translation (English / Brazilian Portuguese) with
// no build step. The language is chosen from localStorage, then the browser's
// language list, then English. Static markup uses data-i18n* attributes;
// app.js uses window.I18N.t() for dynamic strings and re-renders on change.
(function () {
  "use strict";

  var STRINGS = {
    en: {
      "badge.waiting": "Waiting",
      "badge.connecting": "Connecting",
      "badge.live": "Connected",
      "badge.idle": "Offline",

      "subtitle.sender": "Pick files, share the link, and keep this tab open while the other side downloads.",
      "subtitle.receiver": "Choose a folder, then click Download to start the transfer.",

      "link.share": "Share this link",
      "link.code": "Session code",
      "link.copyLink": "Copy link",
      "link.copyCode": "Copy code",
      "link.copied": "Copied",
      "link.inputAria": "Session link",
      "link.qrTitle": "Show QR code",

      "sender.title": "Files to send",
      "sender.hint.waiting": "Waiting for the receiver\u2026",
      "sender.hint.waitingStart": "Waiting for the receiver to start\u2026",
      "sender.drop": "Drop files here or click to choose",
      "sender.clear": "Clear",
      "sender.remove": "Remove",
      "sender.hint.sending": "Sending\u2026",
      "sender.hint.paused": "Paused by the receiver.",
      "sender.hint.done": "All files sent",
      "sender.hint.stopped": "Transfer stopped \u2014 waiting for the receiver to retry.",

      "receiver.title": "Incoming files",
      "receiver.hint.waiting": "Waiting for the sender\u2026",
      "receiver.hint.noFiles": "The sender has not queued any files yet.",
      "receiver.hint.ready": "Ready \u2014 {summary}",
      "receiver.hint.chooseFolder": "Choose a folder, then click Download \u2014 {summary}",
      "receiver.hint.receiving": "Receiving\u2026",
      "receiver.hint.paused": "Paused",
      "receiver.hint.done": "Done",
      "receiver.hint.stopped": "Transfer stopped \u2014 click Retry to resend.",
      "receiver.download": "Download",
      "receiver.retry": "Retry",
      "receiver.pause": "Pause",
      "receiver.resume": "Resume",
      "receiver.chooseFolder": "Choose folder\u2026",
      "receiver.changeFolder": "Change folder\u2026",
      "receiver.noFolder": "Download without a folder",
      "receiver.memoryNote": "This browser can't stream to a folder, so files stay in memory and appear as download links when complete.",
      "receiver.memoryModeNote": "Files will be kept in memory and offered as download links.",
      "receiver.savingTo": "Saving to \u201c{name}\u201d.",
      "receiver.folderError": "That folder can't be used ({reason}). Chrome blocks drive roots and folders with system files. Create a normal folder (for example inside Downloads) and try again.",
      "receiver.fileCount.one": "1 file",
      "receiver.fileCount.many": "{n} files",
      "receiver.summary": "{label} ({size})",

      "state.sending": "Sending\u2026",
      "state.sent": "Sent",
      "state.failed": "Failed",
      "state.notSent": "Not sent",
      "state.progress": "{done} / {total}",
      "state.bytes": "{done}",
      "state.receiving": "Receiving\u2026",
      "state.ready": "Ready",
      "state.saved": "Saved",
      "state.saveFailed": "Save failed",
      "state.incomplete": "Incomplete",

      "log.title": "Log",
      "log.clear": "Clear",
      "log.signalConnected": "Signaling connected",
      "log.signalClosed": "Signaling closed",
      "log.signalError": "Signaling error",
      "log.connection": "Connection: {state}",
      "log.connectionInterrupted": "Connection interrupted; waiting for it to recover.",
      "log.iceRestart": "Connection failed; trying an ICE restart.",
      "log.iceRestartFailed": "ICE restart failed: {msg}",
      "log.connectionFailed": "Connection failed. No TURN relay is configured, so strict NAT or a firewall can block a direct path.",
      "log.offerSent": "Offer sent",
      "log.offerResent": "Offer re-sent (ICE restart)",
      "log.answerSent": "Answer sent",
      "log.peerHere": "Peer is here",
      "log.peerLeft": "Peer disconnected",
      "log.sessionCreated": "Session created: {room}",
      "log.sessionJoined": "Joined session: {room}",
      "log.iceError": "ICE error: {msg}",
      "log.offerFailed": "Offer failed: {msg}",
      "log.answerFailed": "Answer failed: {msg}",
      "log.badAnswer": "Bad answer: {msg}",
      "log.dcOpen": "Data channel open",
      "log.dcClosed": "Data channel closed",
      "log.dcError": "Data channel error",
      "log.dcErrorDetail": "Data channel error: {msg}",
      "log.dcOpenReceiver": "Data channel open (receiver)",
      "log.dcClosedReceiver": "Data channel closed (receiver)",
      "log.dcErrorReceiver": "Data channel error (receiver)",
      "log.sendFailed": "Send failed: {msg}",
      "log.sending": "Sending {name}",
      "log.allSent": "All files sent",
      "log.received": "Received {name}",
      "log.saved": "Saved {name}",
      "log.saveFailed": "Save failed for {name}: {msg}",
      "log.incomplete": "Incomplete: {name}",
      "log.incompleteBytes": "Incomplete: {name} ({received} of {size} bytes)",
      "log.openSaveFailed": "Could not open a file for saving: {msg} \u2014 keeping it in memory.",
      "log.couldNotStart": "Could not start: {msg}",
      "log.clipboardUnavailable": "Clipboard unavailable",
      "log.qrFailed": "QR failed",
      "log.noRoom": "No session id in the URL",
      "log.allReceived": "All files received",

      "footer.github": "GitHub repository",
      "footer.bug": "Report a bug",
      "qr.title": "Scan to open",
      "qr.hint": "Point your phone camera at the code.",
      "qr.close": "Close",
      "lang.label": "Language",

      "home.subtitle": "Send files to a friend over a private link. WebRTC carries the bytes peer-to-peer \u2014 nothing is stored on a server.",
      "home.send.title": "Send files",
      "home.send.body": "Pick files, get a link and share it. Keep this tab open while the other side downloads.",
      "home.receive.title": "Receive files",
      "home.receive.body": "Enter the session code you were given.",
      "home.receive.placeholder": "session code",
      "home.receive.aria": "Session code",
      "home.receive.open": "Open",
      "home.receive.error": "A session code is 3\u201324 characters: a\u2013z, 0\u20139, - or _.",
      "home.how.title": "How it works",
      "home.how.1": "The sender picks files and shares the link (or the QR code) with the receiver.",
      "home.how.2": "The bytes travel directly between the two browsers over a WebRTC DataChannel. The server only helps set up the connection \u2014 it never sees or stores your files.",
      "home.how.3": "Both sides must be online at the same time. Closing the sender's tab ends the transfer.",
      "home.needs.title": "What it needs",
      "home.needs.1": "A current browser (Chrome, Edge, Firefox or Safari).",
      "home.needs.2": "A secure address (HTTPS) \u2014 this page already uses HTTPS.",
      "home.needs.3": "There is no relay server (TURN), so both sides must connect directly. Strict NAT or corporate firewalls can block it; IPv6 helps.",
      "home.needs.4": "Nothing is persisted: no account, no database, no files kept after both tabs close.",

      "report.title": "Report a bug",
      "report.hint": "Copy this report and send it to @{handle} on Discord, or open an issue.",
      "report.copyReport": "Copy report",
      "report.copyHandle": "Copy @{handle}",
      "report.openIssue": "Open an issue",
      "report.close": "Close",
      "report.copied": "Copied",
      "report.aria": "Bug report",
    },

    pt: {
      "badge.waiting": "Aguardando",
      "badge.connecting": "Conectando",
      "badge.live": "Conectado",
      "badge.idle": "Offline",

      "subtitle.sender": "Escolha arquivos, compartilhe o link e mantenha esta aba aberta enquanto o outro lado baixa.",
      "subtitle.receiver": "Escolha uma pasta e clique em Baixar para iniciar a transfer\u00eancia.",

      "link.share": "Compartilhe este link",
      "link.code": "C\u00f3digo da sess\u00e3o",
      "link.copyLink": "Copiar link",
      "link.copyCode": "Copiar c\u00f3digo",
      "link.copied": "Copiado",
      "link.inputAria": "Link da sess\u00e3o",
      "link.qrTitle": "Mostrar QR code",

      "sender.title": "Arquivos para enviar",
      "sender.hint.waiting": "Aguardando o receptor\u2026",
      "sender.hint.waitingStart": "Aguardando o receptor iniciar\u2026",
      "sender.drop": "Solte arquivos aqui ou clique para escolher",
      "sender.clear": "Limpar",
      "sender.remove": "Remover",
      "sender.hint.sending": "Enviando\u2026",
      "sender.hint.paused": "Pausado pelo receptor.",
      "sender.hint.done": "Todos os arquivos enviados",
      "sender.hint.stopped": "Transfer\u00eancia interrompida \u2014 aguardando o receptor tentar novamente.",

      "receiver.title": "Arquivos recebidos",
      "receiver.hint.waiting": "Aguardando o remetente\u2026",
      "receiver.hint.noFiles": "O remetente ainda n\u00e3o adicionou arquivos.",
      "receiver.hint.ready": "Pronto \u2014 {summary}",
      "receiver.hint.chooseFolder": "Escolha uma pasta e clique em Baixar \u2014 {summary}",
      "receiver.hint.receiving": "Recebendo\u2026",
      "receiver.hint.paused": "Pausado",
      "receiver.hint.done": "Conclu\u00eddo",
      "receiver.hint.stopped": "Transfer\u00eancia interrompida \u2014 clique em Tentar novamente.",
      "receiver.download": "Baixar",
      "receiver.retry": "Tentar novamente",
      "receiver.pause": "Pausar",
      "receiver.resume": "Retomar",
      "receiver.chooseFolder": "Escolher pasta\u2026",
      "receiver.changeFolder": "Trocar pasta\u2026",
      "receiver.noFolder": "Baixar sem pasta",
      "receiver.memoryNote": "Este navegador n\u00e3o consegue salvar em pasta; os arquivos ficam na mem\u00f3ria e aparecem como links de download ao terminar.",
      "receiver.memoryModeNote": "Os arquivos ficar\u00e3o na mem\u00f3ria e ser\u00e3o oferecidos como links de download.",
      "receiver.savingTo": "Salvando em \u201c{name}\u201d.",
      "receiver.folderError": "N\u00e3o \u00e9 poss\u00edvel usar essa pasta ({reason}). O Chrome bloqueia a raiz de unidades e pastas com arquivos de sistema. Crie uma pasta comum (por exemplo, dentro de Downloads) e tente novamente.",
      "receiver.fileCount.one": "1 arquivo",
      "receiver.fileCount.many": "{n} arquivos",
      "receiver.summary": "{label} ({size})",

      "state.sending": "Enviando\u2026",
      "state.sent": "Enviado",
      "state.failed": "Falhou",
      "state.notSent": "N\u00e3o enviado",
      "state.progress": "{done} / {total}",
      "state.bytes": "{done}",
      "state.receiving": "Recebendo\u2026",
      "state.ready": "Pronto",
      "state.saved": "Salvo",
      "state.saveFailed": "Falha ao salvar",
      "state.incomplete": "Incompleto",

      "log.title": "Registro",
      "log.clear": "Limpar",
      "log.signalConnected": "Sinaliza\u00e7\u00e3o conectada",
      "log.signalClosed": "Sinaliza\u00e7\u00e3o encerrada",
      "log.signalError": "Erro de sinaliza\u00e7\u00e3o",
      "log.connection": "Conex\u00e3o: {state}",
      "log.connectionInterrupted": "Conex\u00e3o interrompida; aguardando recupera\u00e7\u00e3o.",
      "log.iceRestart": "Falha na conex\u00e3o; tentando reiniciar o ICE.",
      "log.iceRestartFailed": "Falha ao reiniciar o ICE: {msg}",
      "log.connectionFailed": "Falha na conex\u00e3o. N\u00e3o h\u00e1 relay TURN configurado; NAT restrito ou firewall pode bloquear o caminho direto.",
      "log.offerSent": "Oferta enviada",
      "log.offerResent": "Oferta reenviada (rein\u00edcio do ICE)",
      "log.answerSent": "Resposta enviada",
      "log.peerHere": "O outro lado chegou",
      "log.peerLeft": "O outro lado desconectou",
      "log.sessionCreated": "Sess\u00e3o criada: {room}",
      "log.sessionJoined": "Entrou na sess\u00e3o: {room}",
      "log.iceError": "Erro de ICE: {msg}",
      "log.offerFailed": "Falha na oferta: {msg}",
      "log.answerFailed": "Falha na resposta: {msg}",
      "log.badAnswer": "Resposta inv\u00e1lida: {msg}",
      "log.dcOpen": "Canal de dados aberto",
      "log.dcClosed": "Canal de dados fechado",
      "log.dcError": "Erro no canal de dados",
      "log.dcErrorDetail": "Erro no canal de dados: {msg}",
      "log.dcOpenReceiver": "Canal de dados aberto (receptor)",
      "log.dcClosedReceiver": "Canal de dados fechado (receptor)",
      "log.dcErrorReceiver": "Erro no canal de dados (receptor)",
      "log.sendFailed": "Falha no envio: {msg}",
      "log.sending": "Enviando {name}",
      "log.allSent": "Todos os arquivos enviados",
      "log.received": "Recebido {name}",
      "log.saved": "Salvo {name}",
      "log.saveFailed": "Falha ao salvar {name}: {msg}",
      "log.incomplete": "Incompleto: {name}",
      "log.incompleteBytes": "Incompleto: {name} ({received} de {size} bytes)",
      "log.openSaveFailed": "N\u00e3o foi poss\u00edvel abrir um arquivo para salvar: {msg} \u2014 mantendo na mem\u00f3ria.",
      "log.couldNotStart": "N\u00e3o foi poss\u00edvel iniciar: {msg}",
      "log.clipboardUnavailable": "\u00c1rea de transfer\u00eancia indispon\u00edvel",
      "log.qrFailed": "Falha no QR",
      "log.noRoom": "Nenhum ID de sess\u00e3o na URL",
      "log.allReceived": "Todos os arquivos recebidos",

      "footer.github": "Reposit\u00f3rio no GitHub",
      "footer.bug": "Relatar um bug",
      "qr.title": "Escaneie para abrir",
      "qr.hint": "Aponte a c\u00e2mera do celular para o c\u00f3digo.",
      "qr.close": "Fechar",
      "lang.label": "Idioma",

      "home.subtitle": "Envie arquivos para um amigo por um link privado. O WebRTC leva os bytes diretamente entre os navegadores \u2014 nada \u00e9 armazenado em servidor.",
      "home.send.title": "Enviar arquivos",
      "home.send.body": "Escolha arquivos, gere um link e compartilhe. Mantenha esta aba aberta enquanto o outro lado baixa.",
      "home.receive.title": "Receber arquivos",
      "home.receive.body": "Digite o c\u00f3digo da sess\u00e3o que voc\u00ea recebeu.",
      "home.receive.placeholder": "c\u00f3digo da sess\u00e3o",
      "home.receive.aria": "C\u00f3digo da sess\u00e3o",
      "home.receive.open": "Abrir",
      "home.receive.error": "O c\u00f3digo da sess\u00e3o tem de 3 a 24 caracteres: a\u2013z, 0\u20139, - ou _.",
      "home.how.title": "Como funciona",
      "home.how.1": "O remetente escolhe os arquivos e compartilha o link (ou o QR code) com o receptor.",
      "home.how.2": "Os bytes viajam diretamente entre os dois navegadores por um DataChannel WebRTC. O servidor s\u00f3 ajuda a estabelecer a conex\u00e3o \u2014 ele nunca v\u00ea nem armazena seus arquivos.",
      "home.how.3": "Os dois lados precisam estar online ao mesmo tempo. Fechar a aba do remetente encerra a transfer\u00eancia.",
      "home.needs.title": "O que \u00e9 necess\u00e1rio",
      "home.needs.1": "Um navegador atual (Chrome, Edge, Firefox ou Safari).",
      "home.needs.2": "Um endere\u00e7o seguro (HTTPS) \u2014 esta p\u00e1gina j\u00e1 usa HTTPS.",
      "home.needs.3": "N\u00e3o h\u00e1 servidor de relay (TURN), ent\u00e3o os dois lados precisam se conectar diretamente. NAT restrito ou firewalls corporativos podem bloquear; IPv6 ajuda.",
      "home.needs.4": "Nada \u00e9 persistido: sem conta, sem banco de dados, sem arquivos ap\u00f3s fechar as duas abas.",

      "report.title": "Relatar um bug",
      "report.hint": "Copie este relat\u00f3rio e envie para @{handle} no Discord, ou abra uma issue.",
      "report.copyReport": "Copiar relat\u00f3rio",
      "report.copyHandle": "Copiar @{handle}",
      "report.openIssue": "Abrir uma issue",
      "report.close": "Fechar",
      "report.copied": "Copiado",
      "report.aria": "Relat\u00f3rio de bug",
    },
  };

  var STORAGE_KEY = "share.lang";
  var SUPPORTED = ["en", "pt"];

  function detect() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* storage unavailable */ }
    var list = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || "en"];
    for (var i = 0; i < list.length; i++) {
      var low = String(list[i]).toLowerCase();
      if (low.indexOf("pt") === 0) return "pt";
      if (low.indexOf("en") === 0) return "en";
    }
    return "en";
  }

  var lang = detect();

  function t(key, vars) {
    var table = STRINGS[lang] || STRINGS.en;
    var s = table[key];
    if (s == null) s = STRINGS.en[key];
    if (s == null) return key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split("{" + k + "}").join(String(vars[k]));
        }
      }
    }
    return s;
  }

  function apply() {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
    var sel = document.getElementById("langSelect");
    if (sel) sel.value = lang;
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: lang } }));
  }

  function setLang(next) {
    if (SUPPORTED.indexOf(next) === -1) return;
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* storage unavailable */ }
    apply();
  }

  window.I18N = {
    get lang() { return lang; },
    t: t,
    setLang: setLang,
    apply: apply,
  };

  function wire() {
    var sel = document.getElementById("langSelect");
    if (sel) {
      sel.value = lang;
      sel.addEventListener("change", function () { setLang(sel.value); });
    }
    apply();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
