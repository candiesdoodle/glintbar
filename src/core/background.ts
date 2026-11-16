/**
 * Loads every `src/widgets/<domain>/background.ts` once at start-up: a slice's work that must
 * run while none of its tiles is loaded (widgets themselves are code-split and load on demand).
 */
const modules = import.meta.glob("../widgets/*/background.ts");

export async function loadBackground(): Promise<void> {
  await Promise.all(
    Object.entries(modules).map(([path, load]) =>
      load().catch((e) => console.error(`[background] ${path}`, e)),
    ),
  );
}
