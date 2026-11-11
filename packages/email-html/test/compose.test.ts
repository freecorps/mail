import { describe, expect, it } from "vitest";
import { COMPOSER_LIMITS, fillSavedReply, firstName, SAVED_REPLY_VARIABLES } from "../src/compose.ts";

const vars = { nome: "Marina Costa", email: "marina@user.test", caixa: "Suporte", agente: "Bia", numero: 42 };

describe("fillSavedReply", () => {
  it("fills every variable; {primeiro_nome} comes from {nome}", () => {
    expect(fillSavedReply("Olá, {primeiro_nome}! ({nome} <{email}>) #{numero} · {agente}, {caixa}", vars)).toBe(
      "Olá, Marina! (Marina Costa <marina@user.test>) #42 · Bia, Suporte",
    );
    expect(fillSavedReply("Oi {primeiro_nome}", { ...vars, primeiro_nome: "Mari" })).toBe("Oi Mari");
    expect(fillSavedReply("{ nome }", vars)).toBe("Marina Costa");
  });

  it("empties a known variable with no value; leaves unknown ones as written", () => {
    expect(fillSavedReply("Oi {primeiro_nome}, pedido {pedido} {Nome}", {})).toBe("Oi , pedido {pedido} {Nome}");
    expect(fillSavedReply("{nome}|{numero}", { nome: "  ", numero: null })).toBe("|");
  });

  it("escapes values in HTML, never in text", () => {
    const evil = { nome: `<img src=x onerror="a()"> & 'b'` };
    expect(fillSavedReply("<p>Oi {nome}</p>", evil, { html: true })).toBe("<p>Oi &lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;</p>");
    expect(fillSavedReply({ text: "Oi {nome}", bodyHtml: "<p>Oi {nome}</p>" }, evil)).toEqual({ text: `Oi ${evil.nome}`, bodyHtml: "<p>Oi &lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;</p>" });
    expect(fillSavedReply({ text: "Oi {nome}", bodyHtml: null }, vars)).toEqual({ text: "Oi Marina Costa" });
  });

  it("first names: a name's first word, an address's local part", () => {
    expect(firstName("  Ana  Lima ")).toBe("Ana");
    expect(firstName("marina.costa@user.test")).toBe("marina");
    expect(firstName("")).toBe("");
    expect(fillSavedReply("Oi {primeiro_nome}", { nome: "joao@user.test" })).toBe("Oi joao");
  });

  it("documents the variable set and the limits the API enforces", () => {
    expect(SAVED_REPLY_VARIABLES).toEqual(["nome", "primeiro_nome", "email", "caixa", "agente", "numero"]);
    expect(COMPOSER_LIMITS).toMatchObject({ body: 200_000, signatureText: 5_000, signatureHtml: 20_000, title: 200 });
  });
});
