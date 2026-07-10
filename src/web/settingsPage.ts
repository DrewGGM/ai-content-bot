/**
 * Página de AJUSTES del panel:
 *  - Agente IA por usuario con UI CONDICIONAL: cada proveedor muestra solo sus campos
 *    (asistente de login de Claude vs API keys vs login del CLI), y el modelo se elige de
 *    un desplegable dinámico (/api/profile/models: API en vivo o sugerencias) o texto libre.
 *  - Contexto de la empresa (editor de knowledge/ + config/, solo admin).
 *  - Usuarios del panel (solo admin).
 * La página es un shell estático; los datos se cargan por fetch a /api/*.
 */
import { loadBrandConfig } from "../lib/brandConfig.js";
import { icon, esc, baseCss } from "./ui.js";

const PROVIDERS: Array<[string, string]> = [
  ["", "— Default del servidor (.env) —"],
  ["claude", "Claude Code (suscripción, CLI)"],
  ["anthropic", "API Anthropic / compatible"],
  ["openai", "API OpenAI / compatible"],
  ["codex", "OpenAI Codex CLI"],
  ["gemini", "Google Gemini CLI"],
  ["qwen", "Qwen Code CLI"],
  ["kimi", "Kimi Code CLI"],
  ["cursor", "Cursor CLI"],
  ["copilot", "GitHub Copilot CLI"],
  ["opencode", "OpenCode CLI"],
  ["custom", "Comando custom (AGENT_CMD)"],
];

const SECRETS: Array<[string, string]> = [
  ["CLAUDE_CODE_OAUTH_TOKEN", "Token de Claude Code (tu suscripción). Generado con el asistente de arriba o con `claude setup-token` en tu computador."],
  ["ANTHROPIC_API_KEY", "API key de Anthropic, o del endpoint compatible que pongas en la URL base."],
  ["LLM_API_KEY", "API key del endpoint OpenAI-compatible (OpenAI, OpenRouter, Groq, DeepSeek, Ollama…)."],
  ["OPENAI_API_KEY", "API key de OpenAI (Qwen Code también puede usarla como credencial OpenAI-compatible)."],
  ["GEMINI_API_KEY", "API key de Google Gemini (si no usas el login de Google del CLI)."],
  ["DASHSCOPE_API_KEY", "API key de DashScope/Alibaba para Qwen Code."],
];

// Campos no-secretos por proveedor (se guardan dentro de extraEnv).
const ENV_FIELDS: Array<[string, string, string]> = [
  ["ANTHROPIC_BASE_URL", "URL base (opcional — Kimi/Moonshot, GLM, DeepSeek, MiniMax…)", "https://api.moonshot.ai/anthropic"],
  ["LLM_BASE_URL", "URL base (opcional — OpenRouter, Groq, Ollama local…)", "https://api.openai.com/v1"],
  ["AGENT_CMD", "Comando del agente (recibe el prompt por stdin, responde por stdout)", "mi-agente --quiet"],
];

export function settingsPage(user: { id: string; name: string; role: string }, ptyOk: boolean): string {
  const brand = loadBrandConfig();
  const isAdmin = user.role === "admin";
  const providerOptions = PROVIDERS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");

  const envFieldRows = ENV_FIELDS.map(
    ([key, label, ph]) => `
    <div class="mt env-field" id="ef-${key}" style="display:none">
      <label for="env-${key}">${esc(label)} <code>${key}</code></label>
      <input id="env-${key}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">
    </div>`
  ).join("");

  const secretRows = SECRETS.map(
    ([key, desc]) => `
    <div class="secret" data-key="${key}" style="display:none">
      <div class="s-head">
        <code>${key}</code>
        <span class="s-state" id="st-${key}">…</span>
      </div>
      <div class="s-desc">${esc(desc)}</div>
      <div class="s-row">
        <input type="password" placeholder="Pegar valor…" autocomplete="off">
        <button class="btn-primary sm" onclick="saveSecret('${key}', this)">${icon("check")} Guardar</button>
        <button class="btn-ghost sm" onclick="delSecret('${key}')">${icon("trash")}</button>
      </div>
    </div>`
  ).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand.name)} · Ajustes</title>
  <style>${baseCss()}
    header{position:sticky;top:0;z-index:var(--z-header);backdrop-filter:blur(14px);
      background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
    .hbar{max-width:980px;margin:0 auto;padding:14px 22px;display:flex;align-items:center;gap:12px}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
    .brand .badge{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;
      background:linear-gradient(135deg,var(--violet),var(--mint));color:#fff}
    .spacer{flex:1}
    .who{color:var(--mut);font-size:13px;display:inline-flex;align-items:center;gap:7px}
    .back{display:inline-flex;align-items:center;gap:7px;color:var(--mut);text-decoration:none;padding:8px 13px;
      border-radius:10px;border:1px solid var(--line);font-size:13px;font-weight:600}
    .back:hover{color:var(--txt);border-color:var(--violet2)}
    main{max-width:980px;margin:0 auto;padding:22px;display:flex;flex-direction:column;gap:22px}
    .card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);
      border-radius:18px;padding:22px;box-shadow:0 10px 34px #0007}
    .card h2{margin:0 0 4px;font-size:17px;display:flex;align-items:center;gap:10px}
    .card .sub{color:var(--mut);font-size:13px;margin:0 0 18px;line-height:1.5}
    label{display:block;font-size:12px;color:var(--mut);margin:0 0 6px;font-weight:600}
    label code{font-size:10.5px;opacity:.7}
    input,select,textarea{width:100%;padding:11px;border-radius:11px;border:1px solid var(--line);background:#0b0d1c;
      color:var(--txt);font-size:14px;font-family:inherit}
    input:focus,select:focus,textarea:focus{outline:none;border-color:var(--violet2)}
    textarea{resize:vertical;font-family:'Fira Code',monospace;font-size:12.5px;line-height:1.55}
    .row{display:flex;gap:14px;flex-wrap:wrap}.row>div{flex:1;min-width:200px}
    .mt{margin-top:14px}
    .btn-primary,.btn-ghost{padding:11px 18px;border-radius:11px;font-weight:700;font-size:14px;cursor:pointer;
      font-family:inherit;display:inline-flex;align-items:center;gap:7px;justify-content:center}
    .btn-primary{border:0;color:#fff;background:linear-gradient(135deg,var(--violet),var(--violet2))}
    .btn-primary:hover{filter:brightness(1.12)} .btn-primary:disabled{opacity:.5;cursor:default}
    .btn-primary.dangerbtn{background:linear-gradient(135deg,#a93226,#d0453a)}
    .btn-ghost{background:transparent;color:var(--mut);border:1px solid var(--line)} .btn-ghost:hover{color:var(--txt)}
    .btn-primary.sm,.btn-ghost.sm{padding:9px 13px;font-size:13px}
    .msg{font-size:13px;min-height:18px;margin-top:10px}.msg.ok{color:#00c893}.msg.err{color:#ff8f8f}
    .check{display:flex;align-items:flex-start;gap:9px;font-size:13px;color:var(--mut);cursor:pointer;line-height:1.45}
    .check input{width:17px;height:17px;flex:none;margin:1px 0 0;accent-color:var(--violet);cursor:pointer}
    code{font-family:'Fira Code',monospace;font-size:12px;color:var(--mint)}
    .prov-note{margin-top:12px;padding:11px 14px;border-radius:12px;font-size:12.5px;line-height:1.55;color:var(--mut);
      background:color-mix(in srgb,var(--violet) 8%,transparent);border:1px solid color-mix(in srgb,var(--violet2) 35%,var(--line))}
    .prov-note b{color:var(--txt)}
    .model-row{display:flex;gap:8px;align-items:flex-end}
    .model-row>div{flex:1}
    .secret{border:1px solid var(--line);border-radius:13px;padding:13px 15px;margin-top:11px}
    .s-head{display:flex;align-items:center;gap:10px}
    .s-state{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:99px;background:#ffffff12;color:var(--mut)}
    .s-state.on{background:#00a57833;color:#00c893}
    .s-desc{color:var(--mut);font-size:12px;margin:6px 0 9px;line-height:1.45}
    .s-row{display:flex;gap:8px}.s-row input{flex:1}
    .wizard{border:1px dashed var(--violet2);border-radius:13px;padding:15px;margin-top:13px;background:color-mix(in srgb,var(--violet) 7%,transparent)}
    .wizard .step{display:none}.wizard .step.on{display:block}
    .wizard a.lnk{color:var(--mint);word-break:break-all}
    .wz-tail{margin:6px 0 0;padding:9px 11px;border-radius:9px;background:#07080f;border:1px solid var(--line);
      color:var(--mut);font-family:'Fira Code',monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;
      word-break:break-all;max-height:90px;overflow:auto}
    details.adv{margin-top:16px;border:1px solid var(--line);border-radius:13px;padding:0}
    details.adv summary{cursor:pointer;padding:12px 15px;font-size:13px;font-weight:600;color:var(--mut);list-style:none;display:flex;align-items:center;gap:8px}
    details.adv summary::-webkit-details-marker{display:none}
    details.adv[open] summary{border-bottom:1px solid var(--line)}
    details.adv .adv-body{padding:14px 15px}
    .filebar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
    .filebar select{flex:1;min-width:220px;width:auto}
    .brand-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
    .basset{border:1px solid var(--line);border-radius:13px;padding:12px;display:flex;flex-direction:column;gap:9px;align-items:center}
    .basset.cur{border-color:var(--mint)}
    .basset .bimg{height:52px;display:grid;place-items:center;width:100%;background:
      repeating-conic-gradient(#181b2e 0% 25%, #10121f 0% 50%) 0 0/16px 16px;border-radius:9px;overflow:hidden}
    .basset img{max-height:44px;max-width:90%;object-fit:contain}
    .basset .bname{font-size:11px;color:var(--mut);font-family:'Fira Code',monospace;word-break:break-all;text-align:center}
    .basset .cur-tag{font-size:10.5px;font-weight:800;color:var(--mint)}
    table{width:100%;border-collapse:collapse;font-size:13.5px}
    th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
    th{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:.5px}
    .role{font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px;background:#ffffff12}
    .role.admin{background:color-mix(in srgb,var(--violet) 30%,transparent);color:#cdb6ff}
    .danger{color:#e05252}
    .modal{position:fixed;inset:0;background:#000b;display:none;align-items:flex-start;justify-content:center;z-index:50;padding:10vh 16px;backdrop-filter:blur(4px)}
    .modal.show{display:flex}
    .modal-box{width:100%;max-width:440px;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 30px 80px #000c}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:800;font-size:16px}
    .mh-close{background:transparent;border:0;color:var(--mut);cursor:pointer;padding:4px;display:inline-flex}
    .mh-close:hover{color:var(--txt)}
    .cf-body{color:var(--mut);font-size:13.5px;line-height:1.6;margin:0 0 14px}
    .cf-body b{color:var(--txt)}
    .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
    @media (max-width:640px){main{padding:14px}.card{padding:16px}.model-row{flex-wrap:wrap}}
  </style></head><body>
  <header><div class="hbar">
    <a class="back" href="/">${icon("back")}<span>Panel</span></a>
    <span class="brand"><span class="badge">${icon("gear", "ic")}</span> Ajustes</span>
    <span class="spacer"></span>
    <span class="who">${icon("user", "ic sm")} ${esc(user.name)}${isAdmin ? ' · <span class="role admin">admin</span>' : ""}</span>
  </div></header>
  <main>

  <section class="card">
    <h2>${icon("brain")} Tu agente de IA</h2>
    <p class="sub">El copy, el planner, la edición y el QA visual de <b>tus</b> generaciones usan este agente con
    <b>tu</b> cuenta. Elige el proveedor y el formulario te mostrará solo lo que ese proveedor necesita.</p>

    <div class="row">
      <div style="flex:1.2"><label for="pProvider">Proveedor</label><select id="pProvider" onchange="applyProviderUI(true)">${providerOptions}</select></div>
      <div style="flex:1.4"><label for="pModel">Modelo (opcional — escribe o elige)</label>
        <div class="model-row">
          <div><input id="pModel" list="modelList" placeholder="default del proveedor" autocomplete="off" spellcheck="false"><datalist id="modelList"></datalist></div>
          <button class="btn-ghost sm" id="btnModels" onclick="loadModels(this)" title="Cargar la lista de modelos del proveedor">${icon("loader")} Modelos</button>
        </div>
      </div>
      <div><label for="pVision">QA visual (visión)</label><select id="pVision">
        <option value="">Auto (según proveedor)</option><option value="true">Forzar sí</option><option value="false">Forzar no</option>
      </select></div>
    </div>

    <div class="prov-note" id="provNote"></div>
    ${envFieldRows}

    <div class="wizard" id="wizard" style="display:none">
      <b>${icon("link", "ic sm")} Conectar Claude Code con TU cuenta</b>
      <div class="step on" id="wz0">
        <p class="sub conn-yes" id="wzConnMsg" style="display:none;margin:8px 0 10px;color:#00c893">
          <b>✓ Tu cuenta ya está conectada</b> — hay un token guardado y tus generaciones lo usan.
          Solo vuelve a conectar si quieres reemplazarlo (p. ej. otra cuenta o token vencido).</p>
        <p class="sub" id="wzConnNo" style="margin:8px 0 10px">Genera un token de 1 año con tu suscripción de Claude (Pro/Max/Team).
        ${ptyOk
          ? "El asistente corre <code>claude setup-token</code> en el servidor: te da un link, autorizas con tu cuenta y pegas el código."
          : "<b>Asistente no disponible en este servidor</b> (falta node-pty). Método manual: corre <code>claude setup-token</code> en tu computador, copia el token <code>sk-ant-oat01-…</code> y pégalo abajo."}</p>
        ${ptyOk ? `<button class="btn-primary sm" id="wzStartBtn" onclick="wzStart()">${icon("link")} Iniciar login con Claude</button>` : ""}
      </div>
      <div class="step" id="wz1">
        <p class="sub" style="margin:8px 0 6px">1 · Abre este enlace y autoriza con tu cuenta de Claude:</p>
        <p><a class="lnk" id="wzUrl" href="#" target="_blank" rel="noopener"></a></p>
        <p class="sub" style="margin:10px 0 6px">2 · Pega aquí el código que te muestra:</p>
        <div class="s-row"><input id="wzCode" placeholder="Código de autorización" autocomplete="off">
          <button class="btn-primary sm" onclick="wzCode()">${icon("check")} Enviar</button>
          <button class="btn-ghost sm" onclick="wzCancel()">${icon("x")}</button></div>
      </div>
      <div class="step" id="wz2"><p class="sub" style="margin:8px 0">Verificando…</p>
        <pre class="wz-tail" id="wzTail"></pre></div>
      <div class="step" id="wz3"><p class="sub" style="margin:8px 0;color:#00c893"><b>Listo.</b> Tu token quedó guardado — tus generaciones ya usan tu cuenta de Claude.</p></div>
      <div class="msg err" id="wzErr"></div>
    </div>

    <div id="secretsBox">${secretRows}</div>

    <div class="mt" id="isolateWrap" style="display:none"><label class="check"><input type="checkbox" id="pIsolate">
      <span>Aislar credenciales de CLIs para mí (mi propio <code>CLAUDE_CONFIG_DIR</code> y <code>CODEX_HOME</code> en el
      servidor — úsalo si este CLI se loguea por su cuenta y no quieres compartir la sesión del servidor)</span></label></div>

    <details class="adv"><summary>${icon("gear", "ic sm")} Avanzado: variables de entorno extra</summary>
      <div class="adv-body">
        <label for="pExtra">Una por línea, <code>CLAVE=valor</code> (p. ej. <code>LLM_VISION=false</code>, <code>COPY_TIMEOUT_MS=600000</code>)</label>
        <textarea id="pExtra" rows="3" spellcheck="false"></textarea>
      </div>
    </details>

    <div class="mt" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-primary" onclick="saveProfile()">${icon("check")} Guardar agente</button>
      <button class="btn-ghost" onclick="testProfile(this)">${icon("spark")} Probar agente</button>
    </div>
    <div class="msg" id="profMsg"></div>
  </section>

  ${isAdmin ? `
  <section class="card">
    <h2>${icon("file")} Contexto de la empresa</h2>
    <p class="sub">Los archivos de <code>knowledge/</code> y <code>config/</code> que el bot inyecta en cada generación
    (qué hace la empresa, productos, tono, estrategia, identidad de marca). Los cambios aplican de inmediato.
    <b>Crea archivos .md nuevos</b> para prompts personalizados, guías de estilo o contexto extra: el bot los
    lee automáticamente. Los colores y datos básicos de marca se editan en <code>config/brand.json</code>.</p>
    <div class="filebar">
      <select id="ctxFile" onchange="loadCtx()"></select>
      <button class="btn-primary sm" onclick="saveCtx()">${icon("check")} Guardar archivo</button>
      <button class="btn-ghost sm danger" id="ctxDelBtn" onclick="delCtx()" title="Eliminar (solo .md de knowledge/)">${icon("trash")}</button>
    </div>
    <textarea id="ctxBody" rows="18" spellcheck="false" placeholder="Selecciona un archivo…"></textarea>
    <div class="filebar mt">
      <input id="ctxNew" placeholder="nuevo-archivo.md (se crea en knowledge/ — ej. estilo-visual.md, promociones.md)" style="flex:1;min-width:240px">
      <button class="btn-ghost sm" onclick="createCtx()">${icon("check")} Crear archivo</button>
    </div>
    <div class="msg" id="ctxMsg"></div>
  </section>

  <section class="card">
    <h2>${icon("post")} Marca y logos</h2>
    <p class="sub">Sube tus logos a <code>assets/brand/</code> y elige cuál usa el bot como <b>logo principal</b>
    (se superpone en imágenes y videos). Ideal: <b>SVG o PNG con fondo transparente y texto claro</b> (va sobre
    fotos/videos oscuros). Los cambios aplican desde la próxima generación.</p>
    <div id="brandGrid" class="brand-grid"></div>
    <div class="filebar mt">
      <input type="file" id="brandFile" accept=".svg,.png,.jpg,.jpeg,.webp" style="flex:1;min-width:240px;padding:9px">
      <label class="check" style="white-space:nowrap"><input type="checkbox" id="brandSetLogo" checked> <span>usar como logo principal</span></label>
      <button class="btn-primary sm" onclick="uploadBrand(this)">${icon("check")} Subir</button>
    </div>
    <div class="msg" id="brandMsg"></div>
  </section>

  <section class="card">
    <h2>${icon("users")} Usuarios del panel</h2>
    <p class="sub">Cada usuario entra con su contraseña y configura su propio agente/cuenta de IA.
    Los admin además gestionan usuarios y el contexto de empresa.</p>
    <table><thead><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th></th></tr></thead><tbody id="uRows"></tbody></table>
    <div class="row mt">
      <div><label>Nombre</label><input id="uName" autocomplete="off"></div>
      <div><label>Contraseña</label><input id="uPass" type="password" autocomplete="new-password"></div>
      <div><label>Rol</label><select id="uRole"><option value="member">Miembro</option><option value="admin">Admin</option></select></div>
      <div style="display:flex;align-items:flex-end"><button class="btn-primary" onclick="addUser()">${icon("check")} Crear usuario</button></div>
    </div>
    <div class="msg" id="uMsg"></div>
  </section>

  <section class="card">
    <h2>${icon("clock")} Actividad <span style="color:var(--mut);font-weight:500;font-size:12px">— quién hizo qué</span></h2>
    <p class="sub">Registro de acciones del panel y del cron (generaciones, aprobaciones, publicaciones, credenciales,
    usuarios, contexto…). Se guarda en <code>data/audit.jsonl</code>; nunca registra valores de credenciales.</p>
    <div class="filebar"><button class="btn-ghost sm" onclick="loadAudit()">${icon("loader")} Actualizar</button></div>
    <div style="max-height:420px;overflow:auto">
    <table><thead><tr><th style="white-space:nowrap">Cuándo</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
    <tbody id="auditRows"></tbody></table></div>
  </section>` : ""}

  </main>

  <div id="cfModal" class="modal" onclick="if(event.target===this)closeCf()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Confirmar acción">
      <div class="modal-head"><span id="cfTitle"></span>
        <button class="mh-close" onclick="closeCf()" aria-label="Cerrar">${icon("x")}</button></div>
      <p class="cf-body" id="cfBody"></p>
      <div id="cfInputWrap" style="display:none"><input id="cfInput" type="password" autocomplete="new-password" placeholder=""></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeCf()">Cancelar</button>
        <button class="btn-primary" id="cfOk">Confirmar</button>
      </div>
    </div>
  </div>

  <script>
    var IS_ADMIN=${isAdmin ? "true" : "false"};
    function j(url,body){return fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined).then(function(r){
      if(r.status===401){location.href='/';throw new Error('Sesión expirada — vuelve a iniciar sesión')}
      return r.json().then(function(d){if(!r.ok)throw new Error(d&&d.error||('HTTP '+r.status));return d})})}
    function msg(id,text,ok){var el=document.getElementById(id);el.textContent=text;el.className='msg '+(ok?'ok':'err');if(ok)setTimeout(function(){el.textContent=''},4000)}

    // ---- Modal de confirmación (con campo de texto opcional) ----
    var cfCb=null;
    function askConfirm(o,cb){
      cfCb=cb;
      document.getElementById('cfTitle').innerHTML=o.title;
      document.getElementById('cfBody').innerHTML=o.body||'';
      var iw=document.getElementById('cfInputWrap'),inp=document.getElementById('cfInput');
      if(o.input){iw.style.display='block';inp.value='';inp.placeholder=o.input;inp.type=o.inputType||'password'}else{iw.style.display='none'}
      var ok=document.getElementById('cfOk');
      ok.innerHTML=o.ok||'Confirmar';
      ok.className='btn-primary'+(o.danger?' dangerbtn':'');
      document.getElementById('cfModal').classList.add('show');
      setTimeout(function(){(o.input?inp:ok).focus()},50);
    }
    function closeCf(){document.getElementById('cfModal').classList.remove('show');cfCb=null}
    document.addEventListener('keydown',function(e){if(e.key==='Escape')closeCf()});
    document.getElementById('cfOk').addEventListener('click',function(){
      var cb=cfCb,v=document.getElementById('cfInput').value;closeCf();if(cb)cb(v);
    });

    // ---- UI condicional por proveedor ----
    // secrets: credenciales relevantes · fields: inputs no-secretos (van a extraEnv) ·
    // wizard: asistente de Claude · isolate: aplica aislamiento de CLIs · models: sugerencias.
    var PUI={
      '':       {note:'Se usa el agente del <b>servidor</b> (.env), por defecto Claude Code con la suscripción del servidor. Si quieres usar TU cuenta, elige un proveedor.',secrets:['CLAUDE_CODE_OAUTH_TOKEN'],fields:[],wizard:true,isolate:true},
      claude:   {note:'<b>Claude Code CLI</b> con tu suscripción (Pro/Max/Team). Conecta tu cuenta con el asistente (recomendado) o pega un token generado con <code>claude setup-token</code>.',secrets:['CLAUDE_CODE_OAUTH_TOKEN'],fields:[],wizard:true,isolate:true},
      anthropic:{note:'<b>API de Anthropic</b> con API key — o cualquier endpoint compatible (Kimi/Moonshot, GLM/Z.AI, DeepSeek, MiniMax) poniendo su URL base.',secrets:['ANTHROPIC_API_KEY'],fields:['ANTHROPIC_BASE_URL'],wizard:false,isolate:false},
      openai:   {note:'<b>Endpoint OpenAI-compatible</b>: OpenAI, OpenRouter, Groq, DeepSeek, Ollama local… pon la URL base y tu key.',secrets:['LLM_API_KEY'],fields:['LLM_BASE_URL'],wizard:false,isolate:false},
      codex:    {note:'<b>Codex CLI</b>: usa el login de ChatGPT hecho en el servidor (<code>codex login</code>). Activa el aislamiento si quieres tu propio login separado.',secrets:[],fields:[],wizard:false,isolate:true},
      gemini:   {note:'<b>Gemini CLI</b>: usa el login de Google del servidor o tu propia <code>GEMINI_API_KEY</code>.',secrets:['GEMINI_API_KEY'],fields:[],wizard:false,isolate:true},
      qwen:     {note:'<b>Qwen Code CLI</b>: credenciales de DashScope o OpenAI-compatibles.',secrets:['DASHSCOPE_API_KEY','OPENAI_API_KEY'],fields:[],wizard:false,isolate:true},
      kimi:     {note:'<b>Kimi Code CLI</b>: usa el login/config del CLI en el servidor.',secrets:[],fields:[],wizard:false,isolate:true},
      cursor:   {note:'<b>Cursor CLI</b>: usa el login del CLI en el servidor.',secrets:[],fields:[],wizard:false,isolate:true},
      copilot:  {note:'<b>GitHub Copilot CLI</b>: usa el login de GitHub del CLI en el servidor.',secrets:[],fields:[],wizard:false,isolate:true},
      opencode: {note:'<b>OpenCode CLI</b>: multi-proveedor, usa su propia config en el servidor. Sin QA visual.',secrets:[],fields:[],wizard:false,isolate:true},
      custom:   {note:'<b>Comando custom</b>: cualquier ejecutable que reciba el prompt por stdin y responda por stdout. Define el comando abajo. Para QA visual añade <code>AGENT_VISION=true</code> en Avanzado.',secrets:[],fields:['AGENT_CMD'],wizard:false,isolate:true}
    };
    var ENV_FIELD_KEYS=['ANTHROPIC_BASE_URL','LLM_BASE_URL','AGENT_CMD'];
    var modelsLoadedFor=null;

    function applyProviderUI(byUser){
      var p=document.getElementById('pProvider').value;
      var ui=PUI[p]||PUI[''];
      document.getElementById('provNote').innerHTML=ui.note;
      document.getElementById('wizard').style.display=ui.wizard?'':'none';
      document.getElementById('isolateWrap').style.display=ui.isolate?'':'none';
      document.querySelectorAll('.secret').forEach(function(el){
        el.style.display=ui.secrets.indexOf(el.dataset.key)>=0?'':'none';
      });
      ENV_FIELD_KEYS.forEach(function(k){
        document.getElementById('ef-'+k).style.display=ui.fields.indexOf(k)>=0?'':'none';
      });
      if(byUser&&modelsLoadedFor!==p){document.getElementById('modelList').innerHTML='';modelsLoadedFor=null;loadModels(null,true)}
    }

    function fillModels(list){
      document.getElementById('modelList').innerHTML=(list||[]).map(function(m){return '<option value="'+String(m).replace(/"/g,'&quot;')+'">'}).join('');
    }
    function loadModels(btn,quiet){
      var p=document.getElementById('pProvider').value;
      if(btn)btn.disabled=true;
      j('/api/profile/models',{provider:p}).then(function(r){
        if(btn)btn.disabled=false;
        modelsLoadedFor=p;
        fillModels(r.models);
        if(!quiet){
          if(r.error&&!(r.models||[]).length)msg('profMsg','Modelos: '+r.error,false);
          else msg('profMsg',(r.models||[]).length+' modelos '+(r.source==='api'?'cargados del proveedor':'sugeridos')+(r.error?' (API falló: '+r.error+')':''),true);
        }
      }).catch(function(e){if(btn)btn.disabled=false;if(!quiet)msg('profMsg',e.message,false)});
    }

    // ---- Perfil de agente ----
    function renderProfile(p){
      document.getElementById('pProvider').value=p.copyProvider||'';
      document.getElementById('pModel').value=p.copyModel||'';
      document.getElementById('pVision').value=p.copyVision||'';
      document.getElementById('pIsolate').checked=!!p.isolateCli;
      var extra=p.extraEnv||{};
      ENV_FIELD_KEYS.forEach(function(k){
        document.getElementById('env-'+k).value=extra[k]||'';
      });
      document.getElementById('pExtra').value=Object.keys(extra).filter(function(k){return ENV_FIELD_KEYS.indexOf(k)<0})
        .map(function(k){return k+'='+extra[k]}).join('\\n');
      Object.keys(p.secrets||{}).forEach(function(k){
        var el=document.getElementById('st-'+k);
        if(el){el.textContent=p.secrets[k]?'configurado':'no configurado';el.className='s-state'+(p.secrets[k]?' on':'')}
      });
      // Estado del wizard: si ya hay token, se muestra "cuenta conectada" y el botón pasa a "reconectar".
      var conn=!!(p.secrets&&p.secrets.CLAUDE_CODE_OAUTH_TOKEN);
      var cm=document.getElementById('wzConnMsg'),cn=document.getElementById('wzConnNo'),sb=document.getElementById('wzStartBtn');
      if(cm)cm.style.display=conn?'':'none';
      if(cn)cn.style.display=conn?'none':'';
      if(sb)sb.textContent=conn?'Volver a conectar (reemplaza el token)':'Iniciar login con Claude';
      applyProviderUI(false);
    }
    function parseExtra(){
      var out={};
      document.getElementById('pExtra').value.split('\\n').forEach(function(line){
        line=line.trim();if(!line)return;
        var i=line.indexOf('=');if(i<1)throw new Error('Línea inválida en variables extra: '+line);
        out[line.slice(0,i).trim()]=line.slice(i+1).trim();
      });
      // Los campos dedicados (URL base, comando) pisan/añaden sus claves.
      ENV_FIELD_KEYS.forEach(function(k){
        var v=document.getElementById('env-'+k).value.trim();
        if(v)out[k]=v;else delete out[k];
      });
      return out;
    }
    function saveProfile(){
      var extra;try{extra=parseExtra()}catch(e){msg('profMsg',e.message,false);return}
      j('/api/profile',{copyProvider:document.getElementById('pProvider').value,copyModel:document.getElementById('pModel').value,
        copyVision:document.getElementById('pVision').value,isolateCli:document.getElementById('pIsolate').checked,extraEnv:extra})
        .then(function(p){renderProfile(p);msg('profMsg','Agente guardado.',true)})
        .catch(function(e){msg('profMsg',e.message,false)});
    }
    function testProfile(btn){
      btn.disabled=true;msg('profMsg','Probando tu agente (puede tardar unos segundos)…',true);
      j('/api/profile/test',{}).then(function(r){btn.disabled=false;
        if(r.ok)msg('profMsg','✓ El agente respondió: '+r.reply,true);else msg('profMsg','Falló: '+r.error,false)})
        .catch(function(e){btn.disabled=false;msg('profMsg',e.message,false)});
    }
    function saveSecret(key,btn){
      var input=btn.parentElement.querySelector('input');
      var v=input.value.trim();if(!v){msg('profMsg','Pega el valor primero.',false);return}
      j('/api/profile/secret',{key:key,value:v}).then(function(){input.value='';refreshProfile();msg('profMsg',key+' guardado.',true)})
        .catch(function(e){msg('profMsg',e.message,false)});
    }
    function delSecret(key){
      askConfirm({title:'Borrar credencial',body:'Se eliminará <b>'+key+'</b> de tu perfil. Tus generaciones volverán a usar la configuración del servidor (o fallarán si dependían de ella).',ok:'Borrar',danger:true},function(){
        j('/api/profile/secret/delete',{key:key}).then(refreshProfile).catch(function(e){msg('profMsg',e.message,false)});
      });
    }
    function refreshProfile(){j('/api/profile').then(renderProfile).catch(function(){})}
    refreshProfile();
    loadModels(null,true);

    // ---- Wizard Claude Code ----
    var wzTimer=null;
    function wzShow(n){[0,1,2,3].forEach(function(i){document.getElementById('wz'+i).classList.toggle('on',i===n)});document.getElementById('wzErr').textContent=''}
    function wzStart(){
      wzShow(2);
      j('/api/claude-login/start',{}).then(function(){wzPoll()}).catch(function(e){wzShow(0);document.getElementById('wzErr').textContent=e.message});
    }
    function wzPoll(){
      clearTimeout(wzTimer);
      j('/api/claude-login/status').then(function(s){
        if(s.status==='waiting_code'){
          document.getElementById('wzUrl').textContent=s.url;document.getElementById('wzUrl').href=s.url;
          var wasWorking=document.getElementById('wz2').classList.contains('on');
          wzShow(1);
          // Si venimos de "verificando" es porque el intercambio FALLÓ: mostrar por qué y limpiar el campo.
          if(s.error){document.getElementById('wzErr').textContent=s.error;if(wasWorking)document.getElementById('wzCode').value=''}
        }
        else if(s.status==='done'){wzShow(3);refreshProfile();return}
        else if(s.status==='error'){wzShow(0);document.getElementById('wzErr').textContent=s.error||'Error';return}
        else if(s.status==='none'){wzShow(0);document.getElementById('wzErr').textContent='La sesión de login expiró; vuelve a iniciarla.';return}
        else{document.getElementById('wzTail').textContent=s.tail||''}
        wzTimer=setTimeout(wzPoll,1500);
      }).catch(function(){wzTimer=setTimeout(wzPoll,2500)});
    }
    function wzCode(){
      var code=document.getElementById('wzCode').value.trim();
      if(!code)return;
      j('/api/claude-login/code',{code:code}).then(function(){wzShow(2);wzPoll()}).catch(function(e){document.getElementById('wzErr').textContent=e.message});
    }
    function wzCancel(){j('/api/claude-login/cancel',{}).catch(function(){});wzShow(0)}

    // ---- Contexto (admin) ----
    function loadCtxList(preselect){
      if(!IS_ADMIN)return;
      j('/api/context/files').then(function(files){
        var sel=document.getElementById('ctxFile');
        sel.innerHTML=files.map(function(f){return '<option value="'+f.path+'">'+f.path+' ('+(f.bytes/1024).toFixed(1)+' KB)</option>'}).join('');
        if(preselect)sel.value=preselect;
        if(files.length)loadCtx();
      }).catch(function(){});
    }
    function loadCtx(){
      var p=document.getElementById('ctxFile').value;if(!p)return;
      fetch('/api/context/file?path='+encodeURIComponent(p)).then(function(r){if(r.status===401){location.href='/';return ''}return r.text()}).then(function(t){document.getElementById('ctxBody').value=t});
    }
    function saveCtx(){
      var p=document.getElementById('ctxFile').value;if(!p)return;
      j('/api/context/file',{path:p,content:document.getElementById('ctxBody').value})
        .then(function(){msg('ctxMsg','Guardado — aplica desde la próxima generación.',true)})
        .catch(function(e){msg('ctxMsg',e.message,false)});
    }
    function createCtx(){
      var name=document.getElementById('ctxNew').value.trim();
      if(!name)return;
      if(!/\\.md$/i.test(name))name+='.md';
      j('/api/context/create',{path:'knowledge/'+name}).then(function(){
        document.getElementById('ctxNew').value='';
        msg('ctxMsg','Archivo creado — el bot ya lo inyecta como contexto.',true);
        loadCtxList('knowledge/'+name);
      }).catch(function(e){msg('ctxMsg',e.message,false)});
    }
    function delCtx(){
      var p=document.getElementById('ctxFile').value;if(!p)return;
      askConfirm({title:'Eliminar archivo de contexto',body:'Se eliminará <b>'+p+'</b> del contexto de la empresa. El bot dejará de usarlo en las generaciones. Solo se pueden eliminar .md de knowledge/.',ok:'Eliminar archivo',danger:true},function(){
        j('/api/context/delete',{path:p}).then(function(){msg('ctxMsg','Archivo eliminado.',true);loadCtxList()})
          .catch(function(e){msg('ctxMsg',e.message,false)});
      });
    }
    loadCtxList();

    // ---- Marca y logos (admin) ----
    function loadBrand(){
      if(!IS_ADMIN)return;
      j('/api/brand/assets').then(function(assets){
        document.getElementById('brandGrid').innerHTML=assets.map(function(a){
          return '<div class="basset'+(a.isLogo?' cur':'')+'">'+
            '<div class="bimg"><img src="/api/brand/file?name='+encodeURIComponent(a.name)+'" alt=""></div>'+
            '<div class="bname">'+ceHtml(a.name)+'</div>'+
            (a.isLogo?'<span class="cur-tag">✓ logo principal</span>'
              :'<button class="btn-ghost sm" onclick="setLogo(\\''+ceHtml(a.name)+'\\')">Usar como logo</button>')+
            '</div>';
        }).join('')||'<p class="sub">No hay archivos en assets/brand/ — sube tu primer logo abajo.</p>';
      }).catch(function(){});
    }
    function setLogo(name){
      askConfirm({title:'Cambiar logo principal',body:'<b>'+name+'</b> pasará a ser el logo que el bot superpone en imágenes y videos (config/brand.json → logoFile).',ok:'Usar este logo'},function(){
        j('/api/brand/logo',{name:name}).then(function(){msg('brandMsg','Logo principal actualizado.',true);loadBrand()})
          .catch(function(e){msg('brandMsg',e.message,false)});
      });
    }
    function uploadBrand(btn){
      var inp=document.getElementById('brandFile');
      var f=inp.files&&inp.files[0];
      if(!f){msg('brandMsg','Elige un archivo primero.',false);return}
      if(f.size>3*1024*1024){msg('brandMsg','Máximo 3 MB.',false);return}
      var name=f.name.toLowerCase().replace(/[^a-z0-9._-]/g,'-');
      btn.disabled=true;
      var reader=new FileReader();
      reader.onload=function(){
        var b64=String(reader.result).split(',')[1]||'';
        j('/api/brand/upload',{name:name,dataBase64:b64,setAsLogo:document.getElementById('brandSetLogo').checked})
          .then(function(){btn.disabled=false;inp.value='';msg('brandMsg','Logo subido'+(document.getElementById('brandSetLogo').checked?' y marcado como principal':'')+'.',true);loadBrand()})
          .catch(function(e){btn.disabled=false;msg('brandMsg',e.message,false)});
      };
      reader.onerror=function(){btn.disabled=false;msg('brandMsg','No se pudo leer el archivo.',false)};
      reader.readAsDataURL(f);
    }
    loadBrand();

    // ---- Usuarios (admin) ----
    function ceHtml(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
    function loadUsers(){
      if(!IS_ADMIN)return;
      j('/api/users').then(function(users){
        document.getElementById('uRows').innerHTML=users.map(function(u){
          return '<tr><td>'+ceHtml(u.name)+'</td><td><span class="role '+(u.role==='admin'?'admin':'')+'">'+u.role+'</span></td>'+
            '<td>'+u.createdAt.slice(0,10)+'</td>'+
            '<td style="text-align:right;white-space:nowrap"><button class="btn-ghost sm" onclick="resetPass(\\''+u.id+'\\',\\''+ceHtml(u.name)+'\\')">Contraseña</button> '+
            '<button class="btn-ghost sm danger" onclick="delUser(\\''+u.id+'\\',\\''+ceHtml(u.name)+'\\')">Eliminar</button></td></tr>';
        }).join('');
      }).catch(function(){});
    }
    function addUser(){
      j('/api/users',{name:document.getElementById('uName').value,password:document.getElementById('uPass').value,role:document.getElementById('uRole').value})
        .then(function(){document.getElementById('uName').value='';document.getElementById('uPass').value='';loadUsers();msg('uMsg','Usuario creado.',true)})
        .catch(function(e){msg('uMsg',e.message,false)});
    }
    function delUser(id,name){
      askConfirm({title:'Eliminar usuario',body:'Se eliminará a <b>'+name+'</b>. Perderá el acceso al panel y su perfil de agente dejará de usarse.',ok:'Eliminar usuario',danger:true},function(){
        j('/api/users/delete',{id:id}).then(loadUsers).catch(function(e){msg('uMsg',e.message,false)});
      });
    }
    function resetPass(id,name){
      askConfirm({title:'Cambiar contraseña',body:'Nueva contraseña para <b>'+name+'</b> (mínimo 6 caracteres):',ok:'Guardar contraseña',input:'Nueva contraseña'},function(p){
        if(!p)return;
        j('/api/users/password',{id:id,password:p}).then(function(){msg('uMsg','Contraseña actualizada.',true)}).catch(function(e){msg('uMsg',e.message,false)});
      });
    }
    loadUsers();

    // ---- Actividad (admin) ----
    function loadAudit(){
      if(!IS_ADMIN)return;
      j('/api/audit').then(function(rows){
        document.getElementById('auditRows').innerHTML=rows.map(function(e){
          var d=new Date(e.ts);
          var when=d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
          return '<tr><td style="white-space:nowrap;color:var(--mut);font-family:\'Fira Code\',monospace;font-size:11.5px">'+when+'</td>'+
            '<td style="white-space:nowrap">'+ceHtml(e.user)+'</td><td style="white-space:nowrap;font-weight:600">'+ceHtml(e.action)+'</td>'+
            '<td style="color:var(--mut);word-break:break-word">'+ceHtml(e.detail||'')+'</td></tr>';
        }).join('')||'<tr><td colspan="4" style="color:var(--mut)">Sin actividad registrada todavía.</td></tr>';
      }).catch(function(){});
    }
    loadAudit();
  </script></body></html>`;
}
