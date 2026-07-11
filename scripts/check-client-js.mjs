// Extrae los <script> del panel y de Ajustes y valida su SINTAXIS con vm (sin ejecutarlos).
// Detecta el bug de "página vacía" (SyntaxError en el JS del cliente) antes de desplegar.
import vm from "node:vm";
import { settingsPage } from "../src/web/settingsPage.js";

function checkScripts(name, html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!scripts.length) throw new Error(`${name}: no se encontraron <script>`);
  for (const [i, src] of scripts.entries()) {
    try {
      new vm.Script(src);
    } catch (e) {
      const line = e.stack?.split("\n")[0] ?? "";
      throw new Error(`${name} script #${i}: ${e.message} (${line})`);
    }
  }
  console.log(`${name}: ${scripts.length} script(s) OK`);
}

checkScripts("ajustes(admin)", settingsPage({ id: "x", name: "test", role: "admin" }, "csrf"));
checkScripts("ajustes(member)", settingsPage({ id: "x", name: "test", role: "member" }, "csrf"));
console.log("JS del cliente: sintaxis válida ✓");
