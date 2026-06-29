import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the built UI directory (`ui/dist`) by walking up from this module until
 * a package root containing it is found. Works both from `src` (tsx dev) and the
 * bundled `dist/cli.js`.
 */
export function findUiDist(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "ui", "dist");
    if (existsSync(join(candidate, "index.html"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Built UI not found (ui/dist). Run `pnpm build` first.");
}
