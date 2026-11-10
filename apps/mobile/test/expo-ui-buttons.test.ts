// The universal `Button` from "@expo/ui" hands its children to SwiftUI on iOS. A bare string or `{t(...)}` child
// there mounts an RN text view SwiftUI has no component for, and release builds crash on mount (TestFlight
// 1.1.0 (8) and (9), compose). Text goes in `label`; children must be elements such as `<Text>`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "../src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}

/** Opening `<Button ...>` tags (not self-closing) followed by something other than an element. */
function textChildren(source: string): string[] {
  const found: string[] = [];
  const open = /<Button\b/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    // Walk to the end of the tag, skipping `{...}` attribute expressions (they may contain `>`).
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    if (source[i - 1] === "/") continue;
    const rest = source.slice(i + 1).trimStart();
    if (!rest.startsWith("<")) found.push(source.slice(m.index, i + 1 + 40).replace(/\s+/g, " "));
  }
  return found;
}

describe("@expo/ui Button children", () => {
  it("finds a text child, ignores label and element children", () => {
    expect(textChildren(`<Button onPress={() => a > b}>\n  {t("x")}\n</Button>`)).toHaveLength(1);
    expect(textChildren(`<Button>Add</Button>`)).toHaveLength(1);
    expect(textChildren(`<Button label={t("x")} onPress={() => go()} />`)).toHaveLength(0);
    expect(textChildren(`<Button variant="text">\n  <Text>{t("x")}</Text>\n</Button>`)).toHaveLength(0);
  });

  it("no screen passes text as a child", () => {
    const offenders = tsxFiles(src).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      if (!/import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*"@expo\/ui"/.test(source)) return [];
      return textChildren(source).map((tag) => `${file.slice(src.length + 1)}: ${tag}`);
    });
    expect(offenders).toEqual([]);
  });
});
