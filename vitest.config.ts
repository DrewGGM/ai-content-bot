import { defineConfig } from "vitest/config";

// El proyecto usa ESM con imports .js (NodeNext). Este plugin mapea los especificadores
// relativos ".js" a los archivos ".ts" reales para que vitest los resuelva en los tests.
export default defineConfig({
  plugins: [
    {
      name: "resolve-js-to-ts",
      enforce: "pre",
      async resolveId(source, importer) {
        if (importer && source.startsWith(".") && source.endsWith(".js")) {
          const asTs = source.slice(0, -3) + ".ts";
          const resolved = await this.resolve(asTs, importer, { skipSelf: true });
          if (resolved) return resolved;
        }
        return null;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
