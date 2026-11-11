// Email HTML is always drawn on light paper (senders design for white), in both color schemes. No React Native
// imports: the WebView document builder (lib/emailHtml.ts) and its tests use it as plain data.
export const paper = { background: "#FFFFFF", text: "#1C1C1E", quoteRule: "#D1D1D6", quoteText: "#636366", link: "#0A66D8" } as const;
