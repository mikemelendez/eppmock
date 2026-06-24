import { dataMockCatalog } from "../epp/dataMockCatalog.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mockResultClass(resultCode: string): string {
  const code = resultCode.trim();
  if (/^2/.test(code)) {
    return "res-err";
  }
  if (/^1/.test(code) || code === "greeting") {
    return "res-ok";
  }
  return "";
}

function dataMockDocRows(): string {
  return dataMockCatalog
    .map((command, ci) =>
      command.variations
        .map(
          (variation, vi) => `
            <tr>
              ${
                vi === 0
                  ? `<td rowspan="${command.variations.length}"><code>${escapeHtml(command.command)}</code><div class="muted" style="margin-top:4px">id: ${escapeHtml(command.identifier)}</div></td>`
                  : ""
              }
              <td>${escapeHtml(variation.variation)}</td>
              <td><span class="tag-pill">${escapeHtml(variation.tag)}</span></td>
              <td><code class="${mockResultClass(variation.resultCode)}">${escapeHtml(variation.resultCode)}</code></td>
              <td><button type="button" class="mock-view" data-ci="${ci}" data-vi="${vi}">View XML</button></td>
            </tr>`
        )
        .join("")
    )
    .join("");
}

function dataMockCatalogJson(): string {
  return JSON.stringify(dataMockCatalog).replace(/</g, "\\u003c");
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EPP Testing Tool</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a0f;
      --panel: rgba(255, 255, 255, 0.06);
      --panel-strong: rgba(255, 255, 255, 0.1);
      --text: #f6f7fb;
      --muted: #8b95a7;
      --line: rgba(255, 255, 255, 0.12);
      --accent: #8b5cf6;
      --accent-2: #06b6d4;
      --ok: #34d399;
      --danger: #fb7185;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 10%, rgba(139, 92, 246, 0.24), transparent 30rem),
        radial-gradient(circle at 85% 0%, rgba(6, 182, 212, 0.18), transparent 26rem),
        var(--bg);
    }

    main {
      width: min(1440px, calc(100% - 40px));
      margin: 0 auto;
      padding: 32px 0;
    }

    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }

    h1, h2, p { margin: 0; }

    h1 {
      font-size: clamp(32px, 5vw, 56px);
      letter-spacing: -0.06em;
      line-height: 0.95;
    }

    h2 {
      font-size: 16px;
      letter-spacing: -0.02em;
    }

    .muted { color: var(--muted); }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
      gap: 18px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 28px;
      background: linear-gradient(180deg, var(--panel-strong), rgba(255, 255, 255, 0.04));
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(18px);
      overflow: hidden;
    }

    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
    }

    .card-body { padding: 20px; }

    .toolbar {
      display: grid;
      grid-template-columns: 1fr 190px 160px;
      gap: 12px;
      margin-bottom: 14px;
    }

    input, select, textarea {
      width: 100%;
      color: var(--text);
      background: rgba(4, 7, 14, 0.72);
      border: 1px solid var(--line);
      border-radius: 16px;
      outline: none;
    }

    input, select {
      height: 44px;
      padding: 0 14px;
    }

    textarea {
      min-height: 470px;
      resize: vertical;
      padding: 18px;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      tab-size: 2;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 12px 18px;
      color: white;
      background: rgba(255, 255, 255, 0.1);
      cursor: pointer;
      font-weight: 700;
      transition: transform 140ms ease, background 140ms ease;
    }

    button:hover { transform: translateY(-1px); background: rgba(255, 255, 255, 0.15); }
    button.primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
    button.danger { color: #ffdbe2; }
    button:disabled { cursor: wait; opacity: 0.6; transform: none; }

    label.check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
      user-select: none;
    }

    label.check input { width: 16px; height: 16px; }

    .split {
      display: grid;
      gap: 18px;
    }

    .response-stack {
      display: grid;
      gap: 12px;
      max-height: 620px;
      overflow: auto;
      padding-right: 4px;
    }

    .frame {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(4, 7, 14, 0.54);
      overflow: hidden;
    }

    .frame.success {
      border-color: rgba(52, 211, 153, 0.42);
      background: linear-gradient(180deg, rgba(52, 211, 153, 0.12), rgba(4, 7, 14, 0.54));
    }

    .frame.warning {
      border-color: rgba(251, 191, 36, 0.46);
      background: linear-gradient(180deg, rgba(251, 191, 36, 0.12), rgba(4, 7, 14, 0.54));
    }

    .frame.error-status {
      border-color: rgba(251, 113, 133, 0.48);
      background: linear-gradient(180deg, rgba(251, 113, 133, 0.13), rgba(4, 7, 14, 0.54));
    }

    .frame-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .frame-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .status-badge {
      border-radius: 999px;
      padding: 4px 8px;
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      font-size: 11px;
      letter-spacing: 0.04em;
    }

    .status-badge.success { background: rgba(52, 211, 153, 0.24); color: #bbf7d0; }
    .status-badge.warning { background: rgba(251, 191, 36, 0.22); color: #fde68a; }
    .status-badge.error-status { background: rgba(251, 113, 133, 0.24); color: #fecdd3; }

    pre {
      margin: 0;
      padding: 14px;
      overflow: auto;
      color: #dbeafe;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .list {
      display: grid;
      gap: 10px;
      max-height: 250px;
      overflow: auto;
    }

    .pill-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(4, 7, 14, 0.42);
      color: var(--muted);
      font-size: 13px;
    }

    .error {
      padding: 14px;
      border-radius: 18px;
      border: 1px solid rgba(251, 113, 133, 0.36);
      color: #fecdd3;
      background: rgba(251, 113, 133, 0.1);
    }

    .zone-output {
      max-height: 260px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(4, 7, 14, 0.54);
      color: #dbeafe;
    }

    .dnssec-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .dnssec-grid label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .help-list {
      display: grid;
      gap: 10px;
      max-height: 360px;
      overflow: auto;
      padding-right: 4px;
    }

    details.help-item {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(4, 7, 14, 0.42);
      color: var(--muted);
    }

    details.help-item summary {
      cursor: pointer;
      padding: 12px;
      color: var(--text);
      font-weight: 700;
      list-style: none;
    }

    details.help-item summary::-webkit-details-marker { display: none; }

    details.help-item p, details.help-item ul {
      margin: 0;
      padding: 0 12px 12px;
      font-size: 13px;
      line-height: 1.5;
    }

    details.help-item ul {
      padding-left: 28px;
    }

    .credits {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 980px) {
      header, .grid { grid-template-columns: 1fr; display: grid; }
      .toolbar, .dnssec-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="muted">Extensible Provisioning Protocol</p>
        <h1>EPP Testing Tool</h1>
      </div>
    </header>

    <section class="grid">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Request Builder</h2>
            <p class="muted">Choose a template, adjust a second-level .melendez domain, and send XML to the EPP server.</p>
          </div>
        </div>
        <div class="card-body">
          <div class="toolbar">
            <input id="domainName" value="example.melendez" placeholder="example.melendez or café.melendez" />
            <select id="authUser"></select>
            <select id="template">
              <optgroup label="Domain">
                <option value="domain-check">domain:check</option>
                <option value="domain-create">domain:create</option>
                <option value="domain-info">domain:info</option>
                <option value="domain-update">domain:update</option>
                <option value="domain-delete">domain:delete</option>
                <option value="domain-renew">domain:renew</option>
                <option value="transfer-request">domain:transfer (request)</option>
                <option value="transfer-approve">domain:transfer (approve)</option>
                <option value="transfer-query">domain:transfer (query)</option>
              </optgroup>
              <optgroup label="Domain extensions">
                <option value="domain-create-launch">domain:create (launch sunrise)</option>
                <option value="domain-restore">domain:update (RGP restore)</option>
              </optgroup>
              <optgroup label="Contact">
                <option value="contact-check">contact:check</option>
                <option value="contact-create">contact:create</option>
                <option value="contact-info">contact:info</option>
                <option value="contact-update">contact:update</option>
                <option value="contact-delete">contact:delete</option>
              </optgroup>
              <optgroup label="Host">
                <option value="host-check">host:check</option>
                <option value="host-create">host:create</option>
                <option value="host-info">host:info</option>
                <option value="host-update">host:update</option>
                <option value="host-delete">host:delete</option>
              </optgroup>
              <optgroup label="Session">
                <option value="poll">poll</option>
                <option value="hello">hello</option>
                <option value="login">login</option>
                <option value="logout">logout</option>
              </optgroup>
            </select>
          </div>
          <textarea id="xml"></textarea>
          <div class="actions">
            <button class="primary" id="send">Send EPP</button>
            <button id="format">Format</button>
            <button class="danger" id="reset">Reset</button>
            <label class="check"><input id="autoLogin" type="checkbox" /> Auto login</label>
          </div>
        </div>
      </div>

      <div class="split">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>Response</h2>
              <p class="muted">Greeting, login, and command response.</p>
            </div>
          </div>
          <div class="card-body">
            <div id="responses" class="response-stack">
              <div class="pill-row"><span>No requests yet</span><span>Ready</span></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>Registry State</h2>
              <p class="muted">Current domains and latest commands.</p>
            </div>
            <div class="actions" style="margin-top: 0">
              <button id="downloadCsv">Download CSV</button>
              <button id="refresh">Refresh</button>
            </div>
          </div>
          <div class="card-body">
            <h2>Domains</h2>
            <div id="domains" class="list" style="margin: 12px 0 20px"></div>
            <h2>Commands</h2>
            <div id="commands" class="list" style="margin-top: 12px"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>DNS Zone</h2>
              <p class="muted">Generate a BIND-style signed zone file for the entire .melendez TLD.</p>
            </div>
            <div class="actions" style="margin-top: 0">
              <button id="downloadZone">Download</button>
              <button id="generateZone">Generate</button>
            </div>
          </div>
          <div class="card-body">
            <div class="dnssec-grid">
              <label class="check" style="display: flex; align-items: center; margin-top: 22px">
                <input id="dnssecEnabled" type="checkbox" checked /> Include DNSSEC
              </label>
              <label>
                KSK/ZSK action
                <select id="dnssecKeyAction">
                  <option value="generate">Generate keys</option>
                  <option value="renew">Renew keys</option>
                </select>
              </label>
              <label>
                NSEC3 hash
                <input id="nsec3Hash" type="number" min="1" max="255" value="1" />
              </label>
              <label>
                NSEC3 flags
                <input id="nsec3Flags" type="number" min="0" max="255" value="0" />
              </label>
              <label>
                NSEC3 iterations
                <input id="nsec3Iterations" type="number" min="0" max="2500" value="10" />
              </label>
              <label>
                NSEC3 salt
                <input id="nsec3Salt" value="A1B2C3D4" />
              </label>
            </div>
            <pre id="zoneOutput" class="zone-output">No .melendez zone generated yet</pre>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>Help</h2>
              <p class="muted">Documentation for site features and EPP commands.</p>
            </div>
          </div>
          <div class="card-body">
            <div class="help-list">
              <details class="help-item" open>
                <summary>Request Builder</summary>
                <p>Select a command template, edit the generated XML, then click Send EPP. The registry accepts only second-level .melendez domains such as example.melendez, including IDNs like café.melendez.</p>
              </details>
              <details class="help-item">
                <summary>Authentication</summary>
                <p>The user selector controls EPP login credentials for Auto login and the login template. Default users are melendez-admin, melendez-registrar, and melendez-tester.</p>
              </details>
              <details class="help-item">
                <summary>Supported Domain Commands</summary>
                <ul>
                  <li>domain:check verifies availability.</li>
                  <li>domain:create registers a domain with period, nameservers, contacts, authInfo, and optional secDNS DS data.</li>
                  <li>domain:info returns status, registrar, contacts, nameservers, and dates.</li>
                  <li>domain:update modifies nameservers, contacts, statuses, registrant, authInfo, and secDNS DS records.</li>
                  <li>domain:delete removes the domain.</li>
                  <li>domain:renew extends expiration.</li>
                  <li>domain:transfer supports request, query, approve, reject, and cancel.</li>
                  <li>Extensions: secDNS (DS data), launch (sunrise create), and rgp (redemption restore via domain:update).</li>
                </ul>
              </details>
              <details class="help-item">
                <summary>Contact and Host Commands</summary>
                <ul>
                  <li>contact:check/create/info/update/delete manage RFC 5733 contact objects (postalInfo, voice, fax, email, authInfo).</li>
                  <li>host:check/create/info/update/delete manage RFC 5732 host objects with IPv4 and IPv6 glue addresses.</li>
                </ul>
              </details>
              <details class="help-item">
                <summary>Session Commands</summary>
                <p>login authenticates the session, logout closes it, hello returns server capabilities, and poll returns queued server messages (a transfer request enqueues a poll message). The service returns no pending messages by default.</p>
              </details>
              <details class="help-item">
                <summary>RDAP and Data-Based Mock Mode</summary>
                <p>An RDAP service runs on port 8090 (/domain, /nameserver, /entity, /help). A second, stateless EPP service runs on port 7001 that answers from request data only - see the Data-Based Mock Mode table below for the tag conventions.</p>
              </details>
              <details class="help-item">
                <summary>Registry State and CSV</summary>
                <p>The Registry State card shows persisted domains and recent EPP commands. Download CSV exports the full domain table for verification, including statuses, nameservers, contacts, authInfo, DS records, dates, and transfer state.</p>
              </details>
              <details class="help-item">
                <summary>WHOIS</summary>
                <p>WHOIS is available on TCP port 43. Query with a plain domain line.</p>
                <ul>
                  <li>macOS/Linux: <code>printf "example.melendez\\r\\n" | nc eppmock.melendez.mx 43</code></li>
                  <li>Windows PowerShell: <code>"example.melendez\`r\`n" | nc eppmock.melendez.mx 43</code></li>
                </ul>
              </details>
              <details class="help-item">
                <summary>DNS Zone Generator</summary>
                <p>The DNS Zone card generates a BIND-style zone file for the entire .melendez TLD. It includes NS delegations for every persisted .melendez domain, DS records from secDNS data, glue records for in-bailiwick nameservers, persisted KSK/ZSK DNSKEY material, RRSIG signatures, NSEC3 records, and configurable NSEC3PARAM values.</p>
              </details>
              <details class="help-item">
                <summary>Protected Reset</summary>
                <p>Reset clears the entire domain table and command log. It is protected by HTTP Basic Auth using RESET_HTTP_USER and RESET_HTTP_PASSWORD. Defaults are admin and reset-secret.</p>
              </details>
            </div>
          </div>
        </div>

        <div class="card" style="grid-column: 1 / -1">
          <div class="card-head">
            <div>
              <h2>Data-Based Mock Mode &mdash; port 7001</h2>
              <p class="muted">A second, stateless EPP service listens on port 7001 and answers from request data only &mdash; no database, no session state. Connect there and use the tags below (case-insensitive substrings in the highlighted identifier) to drive a specific response. Port 7000 remains the database-backed service.</p>
            </div>
          </div>
          <div class="card-body">
            <style>
              .mock-table { width: 100%; border-collapse: collapse; font-size: 13px; }
              .mock-table th, .mock-table td { text-align: left; vertical-align: middle; padding: 9px 12px; border-bottom: 1px solid var(--line); }
              .mock-table th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--bg); z-index: 1; }
              .mock-table tbody tr:hover { background: rgba(255, 255, 255, 0.03); }
              .mock-table code { color: var(--accent-2); }
              .tag-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; background: var(--panel-strong); border: 1px solid var(--line); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); }
              .res-ok { color: var(--ok) !important; }
              .res-err { color: var(--danger) !important; }
              .mock-view { cursor: pointer; padding: 5px 13px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--text); font-size: 12px; white-space: nowrap; transition: background .15s, border-color .15s, color .15s; }
              .mock-view:hover { background: var(--panel-strong); border-color: var(--accent); color: var(--accent); }

              .mock-modal { position: fixed; inset: 0; background: rgba(3, 5, 10, 0.72); backdrop-filter: blur(6px); display: none; align-items: center; justify-content: center; padding: 24px; z-index: 1000; }
              .mock-modal.open { display: flex; }
              .mock-modal-card { width: min(980px, 100%); max-height: 88vh; display: flex; flex-direction: column; background: #0d1018; border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); overflow: hidden; }
              .mock-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px; border-bottom: 1px solid var(--line); }
              .mock-modal-head h3 { margin: 0; font-size: 16px; }
              .mock-close { background: none; border: none; color: var(--muted); font-size: 26px; line-height: 1; cursor: pointer; padding: 0 4px; }
              .mock-close:hover { color: var(--text); }
              .mock-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 22px 0; }
              .mock-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
              .mock-chip em { color: var(--muted); font-style: normal; }
              .mock-modal-body { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 18px 22px 22px; overflow: auto; }
              .mock-modal-body section { display: flex; flex-direction: column; min-width: 0; }
              .mock-modal-body header { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
              .mock-code { margin: 0; background: #06080d; border: 1px solid var(--line); border-radius: 10px; padding: 14px; overflow: auto; max-height: 56vh; }
              .mock-code code { white-space: pre; font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; }
              @media (max-width: 720px) { .mock-modal-body { grid-template-columns: 1fr; } }
            </style>
            <div style="overflow: auto; max-height: 560px">
              <table class="mock-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Variation</th>
                    <th>Tag (substring in identifier)</th>
                    <th>Result</th>
                    <th>Example</th>
                  </tr>
                </thead>
                <tbody>${dataMockDocRows()}</tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </section>

    <div class="mock-modal" id="mock-modal" role="dialog" aria-modal="true" aria-labelledby="mock-modal-title">
      <div class="mock-modal-card">
        <div class="mock-modal-head">
          <h3 id="mock-modal-title"></h3>
          <button type="button" class="mock-close" data-close aria-label="Close">&times;</button>
        </div>
        <div class="mock-chips" id="mock-modal-meta"></div>
        <div class="mock-modal-body">
          <section>
            <header>Example request</header>
            <pre class="mock-code"><code id="mock-modal-req"></code></pre>
          </section>
          <section>
            <header>Example response</header>
            <pre class="mock-code"><code id="mock-modal-res"></code></pre>
          </section>
        </div>
      </div>
    </div>

    <script id="mock-catalog" type="application/json">${dataMockCatalogJson()}</script>
    <script>
      (function () {
        var catalog = JSON.parse(document.getElementById("mock-catalog").textContent || "[]");
        var modal = document.getElementById("mock-modal");
        var titleEl = document.getElementById("mock-modal-title");
        var metaEl = document.getElementById("mock-modal-meta");
        var reqEl = document.getElementById("mock-modal-req");
        var resEl = document.getElementById("mock-modal-res");

        function isXml(value) {
          return /^\\s*</.test(value) && /(<\\/|\\/>)/.test(value);
        }

        function formatXml(value) {
          if (!isXml(value)) { return value; }
          var withBreaks = value.replace(/>\\s*</g, ">\\n<");
          var pad = 0;
          var lines = withBreaks.split("\\n").map(function (raw) {
            var node = raw.trim();
            if (!node) { return ""; }
            if (/^<\\//.test(node) && pad > 0) { pad -= 1; }
            var line = new Array(pad + 1).join("  ") + node;
            if (/^<[^!?][^>]*[^\\/]>$/.test(node) && !/^<\\//.test(node)) { pad += 1; }
            return line;
          });
          return lines.filter(function (line) { return line.length > 0; }).join("\\n");
        }

        function chip(label, value) {
          var span = document.createElement("span");
          span.className = "mock-chip";
          var em = document.createElement("em");
          em.textContent = label;
          span.appendChild(em);
          span.appendChild(document.createTextNode(value));
          return span;
        }

        function open(ci, vi) {
          var cmd = catalog[ci];
          if (!cmd) { return; }
          var variation = cmd.variations[vi];
          if (!variation) { return; }
          titleEl.textContent = cmd.command + "  \\u00b7  " + variation.variation;
          metaEl.innerHTML = "";
          metaEl.appendChild(chip("identifier", cmd.identifier));
          metaEl.appendChild(chip("tag", variation.tag));
          metaEl.appendChild(chip("result", variation.resultCode));
          reqEl.textContent = formatXml(variation.exampleRequest);
          resEl.textContent = formatXml(variation.exampleResponse);
          modal.classList.add("open");
          document.body.style.overflow = "hidden";
        }

        function close() {
          modal.classList.remove("open");
          document.body.style.overflow = "";
        }

        document.querySelectorAll(".mock-view").forEach(function (btn) {
          btn.addEventListener("click", function () {
            open(Number(btn.getAttribute("data-ci")), Number(btn.getAttribute("data-vi")));
          });
        });
        modal.addEventListener("click", function (event) {
          if (event.target === modal || event.target.hasAttribute("data-close")) { close(); }
        });
        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape") { close(); }
        });
      })();
    </script>
    <p class="credits">This site was created for testing purposes -  Credits : Mike Melendez miguel@melendez.mx</p>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const xml = $("xml");
    const domainName = $("domainName");
    const template = $("template");
    const authUserSelect = $("authUser");
    const autoLogin = $("autoLogin");
    const responses = $("responses");
    const domains = $("domains");
    const commands = $("commands");
    const zoneOutput = $("zoneOutput");
    const dnssecEnabled = $("dnssecEnabled");
    const dnssecKeyAction = $("dnssecKeyAction");
    const nsec3Hash = $("nsec3Hash");
    const nsec3Flags = $("nsec3Flags");
    const nsec3Iterations = $("nsec3Iterations");
    const nsec3Salt = $("nsec3Salt");
    let authUsers = [
      { clid: "melendez-admin", password: "admin-secret" },
      { clid: "melendez-registrar", password: "registrar-secret" },
      { clid: "melendez-tester", password: "tester-secret" }
    ];

    const templates = {
      "login": (_domain, user) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>\${escapeHtml(user.clid)}</clID>
      <pw>\${escapeHtml(user.password)}</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
        <objURI>urn:ietf:params:xml:ns:domain-1.0</objURI>
      </svcs>
    </login>
    <clTRID>dashboard-login</clTRID>
  </command>
</epp>\`,
      "domain-check": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
      </domain:check>
    </check>
    <clTRID>dashboard-check</clTRID>
  </command>
</epp>\`,
      "domain-create": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
        <domain:period unit="y">1</domain:period>
        <domain:ns>
          <domain:hostObj>ns1.\${escapeHtml(domain)}</domain:hostObj>
          <domain:hostObj>ns2.\${escapeHtml(domain)}</domain:hostObj>
        </domain:ns>
        <domain:registrant>CONTACT-001</domain:registrant>
        <domain:contact type="admin">CONTACT-ADMIN</domain:contact>
        <domain:contact type="tech">CONTACT-TECH</domain:contact>
        <domain:authInfo>
          <domain:pw>domain-secret</domain:pw>
        </domain:authInfo>
      </domain:create>
    </create>
    <extension>
      <secDNS:create xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1">
        <secDNS:dsData>
          <secDNS:keyTag>12345</secDNS:keyTag>
          <secDNS:alg>13</secDNS:alg>
          <secDNS:digestType>2</secDNS:digestType>
          <secDNS:digest>0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF</secDNS:digest>
        </secDNS:dsData>
      </secDNS:create>
    </extension>
    <clTRID>dashboard-create</clTRID>
  </command>
</epp>\`,
      "domain-info": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
      </domain:info>
    </info>
    <clTRID>dashboard-info</clTRID>
  </command>
</epp>\`,
      "domain-update": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
        <domain:add>
          <domain:ns>
            <domain:hostObj>ns3.\${escapeHtml(domain)}</domain:hostObj>
          </domain:ns>
          <domain:contact type="admin">CONTACT-ADMIN-2</domain:contact>
          <domain:status s="clientTransferProhibited" />
        </domain:add>
        <domain:rem>
          <domain:ns>
            <domain:hostObj>ns2.\${escapeHtml(domain)}</domain:hostObj>
          </domain:ns>
        </domain:rem>
        <domain:chg>
          <domain:registrant>CONTACT-002</domain:registrant>
          <domain:authInfo>
            <domain:pw>new-domain-secret</domain:pw>
          </domain:authInfo>
        </domain:chg>
      </domain:update>
    </update>
    <extension>
      <secDNS:update xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1">
        <secDNS:add>
          <secDNS:dsData>
            <secDNS:keyTag>54321</secDNS:keyTag>
            <secDNS:alg>13</secDNS:alg>
            <secDNS:digestType>2</secDNS:digestType>
            <secDNS:digest>FEDCBA9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA9876543210</secDNS:digest>
          </secDNS:dsData>
        </secDNS:add>
        <secDNS:rem>
          <secDNS:dsData>
            <secDNS:keyTag>12345</secDNS:keyTag>
            <secDNS:alg>13</secDNS:alg>
            <secDNS:digestType>2</secDNS:digestType>
            <secDNS:digest>0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF</secDNS:digest>
          </secDNS:dsData>
        </secDNS:rem>
      </secDNS:update>
    </extension>
    <clTRID>dashboard-update</clTRID>
  </command>
</epp>\`,
      "domain-delete": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <domain:delete xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
      </domain:delete>
    </delete>
    <clTRID>dashboard-delete</clTRID>
  </command>
</epp>\`,
      "domain-renew": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <renew>
      <domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
        <domain:period unit="y">1</domain:period>
      </domain:renew>
    </renew>
    <clTRID>dashboard-renew</clTRID>
  </command>
</epp>\`,
      "transfer-request": (domain) => transferTemplate(domain, "request"),
      "transfer-approve": (domain) => transferTemplate(domain, "approve"),
      "transfer-query": (domain) => transferTemplate(domain, "query"),
      "domain-create-launch": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
        <domain:authInfo>
          <domain:pw>domain-secret</domain:pw>
        </domain:authInfo>
      </domain:create>
    </create>
    <extension>
      <launch:create xmlns:launch="urn:ietf:params:xml:ns:launch-1.0">
        <launch:phase>sunrise</launch:phase>
      </launch:create>
    </extension>
    <clTRID>dashboard-create-launch</clTRID>
  </command>
</epp>\`,
      "domain-restore": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
      </domain:update>
    </update>
    <extension>
      <rgp:update xmlns:rgp="urn:ietf:params:xml:ns:rgp-1.0">
        <rgp:restore op="request" />
      </rgp:update>
    </extension>
    <clTRID>dashboard-restore</clTRID>
  </command>
</epp>\`,
      "contact-check": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <contact:check xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
      </contact:check>
    </check>
    <clTRID>dashboard-contact-check</clTRID>
  </command>
</epp>\`,
      "contact-create": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <contact:create xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:postalInfo type="int">
          <contact:name>John Doe</contact:name>
          <contact:org>Example Inc.</contact:org>
          <contact:addr>
            <contact:street>123 Example Dr.</contact:street>
            <contact:city>Dulles</contact:city>
            <contact:sp>VA</contact:sp>
            <contact:pc>20166</contact:pc>
            <contact:cc>US</contact:cc>
          </contact:addr>
        </contact:postalInfo>
        <contact:voice>+1.7035555555</contact:voice>
        <contact:email>jdoe@example.melendez</contact:email>
        <contact:authInfo>
          <contact:pw>contact-secret</contact:pw>
        </contact:authInfo>
      </contact:create>
    </create>
    <clTRID>dashboard-contact-create</clTRID>
  </command>
</epp>\`,
      "contact-info": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
      </contact:info>
    </info>
    <clTRID>dashboard-contact-info</clTRID>
  </command>
</epp>\`,
      "contact-update": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <contact:update xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:chg>
          <contact:email>new-email@example.melendez</contact:email>
        </contact:chg>
      </contact:update>
    </update>
    <clTRID>dashboard-contact-update</clTRID>
  </command>
</epp>\`,
      "contact-delete": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <contact:delete xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
      </contact:delete>
    </delete>
    <clTRID>dashboard-contact-delete</clTRID>
  </command>
</epp>\`,
      "host-check": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <host:check xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.\${escapeHtml(domain)}</host:name>
      </host:check>
    </check>
    <clTRID>dashboard-host-check</clTRID>
  </command>
</epp>\`,
      "host-create": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.\${escapeHtml(domain)}</host:name>
        <host:addr ip="v4">192.0.2.10</host:addr>
        <host:addr ip="v6">2001:db8::1</host:addr>
      </host:create>
    </create>
    <clTRID>dashboard-host-create</clTRID>
  </command>
</epp>\`,
      "host-info": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <host:info xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.\${escapeHtml(domain)}</host:name>
      </host:info>
    </info>
    <clTRID>dashboard-host-info</clTRID>
  </command>
</epp>\`,
      "host-update": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <host:update xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.\${escapeHtml(domain)}</host:name>
        <host:add>
          <host:addr ip="v6">2001:db8::2</host:addr>
        </host:add>
        <host:rem>
          <host:addr ip="v4">192.0.2.10</host:addr>
        </host:rem>
      </host:update>
    </update>
    <clTRID>dashboard-host-update</clTRID>
  </command>
</epp>\`,
      "host-delete": (domain) => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <host:delete xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.\${escapeHtml(domain)}</host:name>
      </host:delete>
    </delete>
    <clTRID>dashboard-host-delete</clTRID>
  </command>
</epp>\`,
      "poll": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <poll op="req" />
    <clTRID>dashboard-poll</clTRID>
  </command>
</epp>\`,
      "hello": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <hello />
</epp>\`,
      "logout": () => \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <logout />
    <clTRID>dashboard-logout</clTRID>
  </command>
</epp>\`
    };

    function transferTemplate(domain, operation) {
      return \`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <transfer op="\${operation}">
      <domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>\${escapeHtml(domain)}</domain:name>
        <domain:authInfo>
          <domain:pw>domain-secret</domain:pw>
        </domain:authInfo>
      </domain:transfer>
    </transfer>
    <clTRID>dashboard-transfer-\${operation}</clTRID>
  </command>
</epp>\`;
    }

    function applyTemplate() {
      xml.value = templates[template.value](
        domainName.value.trim() || "example.melendez",
        selectedAuthUser()
      );
    }

    function selectedAuthUser() {
      return authUsers.find((user) => user.clid === authUserSelect.value) || authUsers[0];
    }

    function renderAuthUsers() {
      authUserSelect.innerHTML = authUsers
        .map((user) => \`<option value="\${escapeHtml(user.clid)}">\${escapeHtml(user.clid)}</option>\`)
        .join("");
    }

    function escapeHtml(value) {
      return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    function prettyXml(value) {
      return value
        .replace(/>\\s*</g, ">\\n<")
        .split("\\n")
        .reduce((lines, line) => {
          const trimmed = line.trim();
          const isClose = /^<\\//.test(trimmed);
          const isOpen = /^<[^!?/][^>]*[^/]?>$/.test(trimmed) && !/^<[^>]+>[^<]+<\\//.test(trimmed);
          const level = Math.max(lines.level + (isClose ? -1 : 0), 0);
          lines.output.push("  ".repeat(level) + trimmed);
          lines.level = level + (isOpen ? 1 : 0);
          return lines;
        }, { level: 0, output: [] }).output.join("\\n");
    }

    function renderFrames(frames) {
      responses.innerHTML = frames.map((frame) => {
        const status = responseStatus(frame.xml);

        return \`
        <article class="frame \${status.className}">
          <div class="frame-title">
            <span>\${frame.type}</span>
            <span class="frame-meta">
              <span class="status-badge \${status.className}">\${status.label}</span>
              <span>\${formatDateTime(new Date())}</span>
            </span>
          </div>
          <pre>\${escapeHtml(prettyXml(frame.xml))}</pre>
        </article>\`;
      }).join("");
    }

    function responseStatus(xmlValue) {
      const code = xmlValue.match(/<result\\s+code="(\\d+)"/)?.[1];
      const message = xmlValue.match(/<msg>([^<]+)<\\/msg>/)?.[1] || "";

      if (!code) {
        return { className: "", label: "INFO" };
      }

      if (code === "1000") {
        return { className: "success", label: \`SUCCESS \${code}\` };
      }

      if (isBusinessStatus(code, message)) {
        return { className: "warning", label: \`NOTICE \${code}\` };
      }

      return { className: "error-status", label: \`ERROR \${code}\` };
    }

    function isBusinessStatus(code, message) {
      const normalized = message.toLowerCase();
      return (
        code === "1300" ||
        code === "2302" ||
        code === "2303" ||
        normalized.includes("object exists") ||
        normalized.includes("object does not exist") ||
        normalized.includes("no messages")
      );
    }

    function renderError(error) {
      responses.innerHTML = \`<div class="error">\${escapeHtml(error.message || String(error))}</div>\`;
    }

    async function sendRequest() {
      $("send").disabled = true;
      try {
        const user = selectedAuthUser();
        const response = await fetch("/epp/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            xml: xml.value,
            autoLogin: autoLogin.checked,
            clid: user.clid,
            password: user.password
          })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "The request could not be sent");
        renderFrames(payload.frames);
        await refreshState();
      } catch (error) {
        renderError(error);
      } finally {
        $("send").disabled = false;
      }
    }

    async function refreshState() {
      const [domainResponse, commandResponse] = await Promise.all([
        fetch("/domains"),
        fetch("/commands?limit=8")
      ]);

      const domainPayload = await domainResponse.json();
      domains.innerHTML = domainPayload.length
        ? domainPayload.map((domain) => \`<div class="pill-row"><span>\${escapeHtml(domain.name)}</span><span>\${escapeHtml(domain.statuses.join(", "))}\${domain.dsRecords?.length ? " · DS " + domain.dsRecords.length : ""}</span></div>\`).join("")
        : \`<div class="pill-row"><span>No domains</span><span>empty registry</span></div>\`;

      const commandPayload = await commandResponse.json();
      commands.innerHTML = commandPayload.length
        ? commandPayload.map((command) => \`<div class="pill-row"><span>\${escapeHtml(command.commandName)}</span><span>\${formatDateTime(command.createdAt)}</span></div>\`).join("")
        : \`<div class="pill-row"><span>No commands</span><span>no activity</span></div>\`;
    }

    function formatDateTime(value) {
      return new Date(value).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    async function resetState() {
      const user = prompt("Reset HTTP user");
      if (!user) return;
      const password = prompt("Reset HTTP password");
      if (password === null) return;

      const response = await fetch("/admin/domains/reset", {
        method: "POST",
        headers: {
          "authorization": \`Basic \${btoa(\`\${user}:\${password}\`)}\`
        }
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: "Reset failed" }));
        renderError(new Error(payload.message || "Reset failed"));
        return;
      }

      await refreshState();
    }

    async function generateZone() {
      const response = await fetch(\`/dns/zone?\${dnsZoneParams().toString()}\`);

      if (!response.ok) {
        renderError(new Error("DNS zone could not be generated"));
        return;
      }

      zoneOutput.textContent = await response.text();
    }

    function downloadZone() {
      const params = dnsZoneParams();
      params.set("download", "true");
      window.location.href = \`/dns/zone?\${params.toString()}\`;
    }

    function dnsZoneParams() {
      const params = new URLSearchParams();
      params.set("dnssec", dnssecEnabled.checked ? "true" : "false");
      params.set("keyAction", dnssecKeyAction.value);
      params.set("nsec3Hash", nsec3Hash.value || "1");
      params.set("nsec3Flags", nsec3Flags.value || "0");
      params.set("nsec3Iterations", nsec3Iterations.value || "10");
      params.set("nsec3Salt", nsec3Salt.value.trim() || "A1B2C3D4");
      return params;
    }

    async function loadAuthUsers() {
      const response = await fetch("/auth/users");
      if (!response.ok) return;
      authUsers = await response.json();
      renderAuthUsers();
    }

    template.addEventListener("change", applyTemplate);
    domainName.addEventListener("input", applyTemplate);
    authUserSelect.addEventListener("change", applyTemplate);
    $("send").addEventListener("click", sendRequest);
    $("format").addEventListener("click", () => { xml.value = prettyXml(xml.value); });
    $("refresh").addEventListener("click", refreshState);
    $("downloadCsv").addEventListener("click", () => {
      window.location.href = "/domains.csv";
    });
    $("generateZone").addEventListener("click", generateZone);
    $("downloadZone").addEventListener("click", downloadZone);
    $("reset").addEventListener("click", resetState);

    renderAuthUsers();
    loadAuthUsers()
      .then(applyTemplate)
      .then(refreshState)
      .catch(renderError);
  </script>
</body>
</html>`;
}
