import type { Awareness } from "y-protocols/awareness";

export function installRemoteCursorStyles(awareness: Awareness, localClientId: number): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-liveclip-cursors", "true");
  document.head.appendChild(style);

  const render = () => {
    const rules: string[] = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === localClientId) {
        return;
      }
      const user = state.user as { name?: string; color?: string } | undefined;
      const color = user?.color || "#2563eb";
      const name = String(user?.name || "Guest")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      rules.push(`
        .yRemoteSelection-${clientId} { background-color: ${color}33; }
        .yRemoteSelectionHead-${clientId} {
          border-left: 2px solid ${color};
          border-top: 2px solid ${color};
          border-bottom: 2px solid ${color};
        }
        .yRemoteSelectionHead-${clientId}::after {
          content: "${name}";
          background: ${color};
          color: #fff;
        }
      `);
    });
    style.textContent = rules.join("\n");
  };

  awareness.on("change", render);
  render();
  return () => {
    awareness.off("change", render);
    style.remove();
  };
}
