// Dev only (break-ui): Demo / Worst case / Empty / One for the sidebar and Hoje. Plain chrome on purpose: it is not part
// of the design under test. Rendered only when import.meta.env.DEV.
import { DEV_DATA, setDevData, useDevData, type DevData } from "./data";

const LABEL: Record<DevData | "demo", string> = { demo: "Demo data", worst: "Worst case", empty: "Empty", one: "One" };

export function DataToggle() {
  const current = useDevData();
  return (
    <fieldset
      aria-label="Dev data"
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        gap: 2,
        padding: 2,
        borderRadius: 8,
        background: "#d4d4d4",
        font: "12px system-ui, sans-serif",
        border: 0,
        margin: 0,
      }}
    >
      {(["demo", ...DEV_DATA] as const).map((k) => {
        const on = (current ?? "demo") === k;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => setDevData(k === "demo" ? null : k)}
            style={{
              border: 0,
              borderRadius: 6,
              padding: "4px 10px",
              background: on ? "#fff" : "transparent",
              color: "#171717",
              cursor: "pointer",
            }}
          >
            {LABEL[k]}
          </button>
        );
      })}
    </fieldset>
  );
}
