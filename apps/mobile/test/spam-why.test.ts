// The Spam banner's words for a message the filter filed: its category and its first signals.
import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n/strings";
import { spamWhyText } from "../src/model/spam-why";

const pt = ((k: never, v?: Record<string, string | number>) => translate("pt-BR", k, v)) as never;
const en = ((k: never, v?: Record<string, string | number>) => translate("en", k, v)) as never;

describe("spam banner: why the filter filed it", () => {
  it("category, then up to three known signals with their detail", () => {
    const why = { reason: "filter", category: "phishing", signals: ["new-domain:hotelx.com.br", "stranger-invoice", "deceptive-link:www.bb.com.br→bb-seguro.top", "call-to-action"] };
    expect(spamWhyText(why, pt)).toBe("Provável golpe (phishing): domínio criado há poucos dias (hotelx.com.br), cobrança de quem nunca escreveu, link disfarçado (www.bb.com.br → bb-seguro.top).");
    expect(spamWhyText(why, en)).toBe("Likely phishing: domain registered days ago (hotelx.com.br), a bill from someone who never wrote before, disguised link (www.bb.com.br → bb-seguro.top).");
  });
  it("unknown codes are skipped; no signals is the category alone; rules and the rate are not the filter", () => {
    expect(spamWhyText({ reason: "filter", category: "spam", signals: ["something-new", "marketing"] }, pt)).toBe("Parece spam: oferta não solicitada.");
    expect(spamWhyText({ reason: "filter", category: "malware" }, en)).toBe("Dangerous file or link.");
    expect(spamWhyText({ reason: "rule" }, pt)).toBeNull();
    expect(spamWhyText(null, pt)).toBeNull();
  });
});
