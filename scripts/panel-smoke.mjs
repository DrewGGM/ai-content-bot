// Smoke test del PANEL con sesión real: crea un usuario temporal, inicia sesión por HTTP,
// valida la sintaxis del JS del cliente del panel y de Ajustes, prueba /api/workflows, y limpia.
import vm from "node:vm";
import { createUser, deleteUser } from "../src/lib/users.js";

const BASE = "http://localhost:4321";
const NAME = "_smoke-test";
const PASS = "smoke-" + Math.random().toString(36).slice(2, 10);

const u = createUser(NAME, PASS, "admin");
try {
  const login = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: NAME, password: PASS }).toString(),
    redirect: "manual",
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`login falló: ${login.status} ${await login.text()}`);

  for (const path of ["/", "/settings"]) {
    const res = await fetch(BASE + path, { headers: { Cookie: cookie } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const html = await res.text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const [i, src] of scripts.entries()) new vm.Script(src); // lanza si hay SyntaxError
    console.log(`${path}: HTTP 200, ${scripts.length} script(s) con sintaxis OK`);
    // los elementos nuevos existen
    for (const id of path === "/" ? ["genMusicRow", "editMusicRow", "genFormat"] : ["wfRows", "skRows", "snRows", "styleText", "mRows"]) {
      if (!html.includes(`id="${id}"`)) throw new Error(`${path}: falta #${id}`);
    }
  }

  const wf = await (await fetch(`${BASE}/api/workflows`, { headers: { Cookie: cookie } })).json();
  console.log("workflows:", wf.workflows.map((w) => w.name).join(", "), "· template:", wf.template ? "sí" : "no");
  const soc = await (await fetch(`${BASE}/api/social`, { headers: { Cookie: cookie } })).json();
  console.log("credenciales listadas:", soc.length, "· con valores expuestos:", soc.some((s) => s.value) ? "SÍ (MAL)" : "no ✓");
  const sk = await (await fetch(`${BASE}/api/skills`, { headers: { Cookie: cookie } })).json();
  console.log("skills:", sk.map((s) => s.dir + (s.enabled ? "" : " (off)")).join(", "));
  const st = await (await fetch(`${BASE}/api/style`, { headers: { Cookie: cookie } })).json();
  console.log("estilos: override", st.override ? "presente" : "vacío ✓", "· default", st.default ? "presente ✓" : "FALTA");
  console.log("SMOKE OK");
} finally {
  deleteUser(u.id);
}
