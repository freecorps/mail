// Wave 6 polish: the input modality that turns off keyboard-opened animations, the browser chrome color, and the admin
// strings that arrive with the admin chunk.
import { afterEach, describe, expect, it } from "vite-plus/test";
import { adminEn, adminPtBR } from "@/i18n/admin";
import { registerStrings, translate } from "@/i18n/strings";
import { modalityOfKey, trackModality } from "@/lib/modality";
import { applyThemeColor, THEME_COLOR } from "@/lib/prefs";

describe("modality", () => {
  it("a key is keyboard, a modifier alone keeps what was there", () => {
    expect(modalityOfKey("k", "pointer")).toBe("keyboard");
    expect(modalityOfKey("Enter", "pointer")).toBe("keyboard");
    expect(modalityOfKey("Escape", "pointer")).toBe("keyboard");
    expect(modalityOfKey("Meta", "pointer")).toBe("pointer");
    expect(modalityOfKey("Shift", "keyboard")).toBe("keyboard");
  });

  it("tracks the last input on the root, before the handlers that open things", () => {
    const root = document.createElement("div");
    const stop = trackModality(root);
    expect(root.dataset.modality).toBe("pointer");
    let seen: string | undefined;
    const handler = () => (seen = root.dataset.modality);
    window.addEventListener("keydown", handler);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(seen).toBe("keyboard");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(root.dataset.modality).toBe("keyboard");
    window.dispatchEvent(new Event("pointerdown"));
    expect(root.dataset.modality).toBe("pointer");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    expect(root.dataset.modality).toBe("pointer");
    window.removeEventListener("keydown", handler);
    stop();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(root.dataset.modality).toBe("pointer");
  });
});

describe("theme-color", () => {
  afterEach(() => {
    for (const m of document.head.querySelectorAll('meta[name="theme-color"]')) m.remove();
  });

  it("follows the app's theme, not only the OS one", () => {
    for (const media of ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]) {
      const m = document.createElement("meta");
      m.name = "theme-color";
      m.media = media;
      document.head.append(m);
    }
    applyThemeColor("dark");
    const metas = [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    expect(metas.map((m) => m.content)).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    applyThemeColor("light");
    expect(metas.map((m) => m.content)).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });
});

describe("admin strings", () => {
  it("the shell's are there from the start, the rest once the admin chunk registers them", () => {
    expect(translate("en", "admin.open")).toBe("Administration");
    expect(translate("pt-BR", "admin.section.keys")).toBe("Chaves de API");
    expect(translate("en", "admin.save")).toBe("admin.save");
    registerStrings({ "pt-BR": adminPtBR, en: adminEn });
    expect(translate("en", "admin.save")).toBe(adminEn["admin.save"]);
    expect(translate("pt-BR", "admin.failed", { message: "x" })).toBe("Não deu certo: x");
  });
});
