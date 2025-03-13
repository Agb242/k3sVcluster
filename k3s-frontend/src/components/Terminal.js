"use client";

import { useEffect, useRef, useState } from "react";
import "xterm/css/xterm.css";
import "@/styles/globals.css";

export default function TerminalComponent() {
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const terminal = useRef(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState({
    background: "#1e1e1e",
    foreground: "#ffffff",
    cursor: "#ffffff",
  });
  const [lensUrl, setLensUrl] = useState(null);

  const toggleFullScreen = () => {
    if (!isFullScreen) {
      termRef.current?.requestFullscreen?.();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullScreen(false);
    }
  };

  useEffect(() => {
    let Terminal;

    import("xterm")
      .then((mod) => {
        if (!mod?.Terminal) {
          console.error("Erreur lors du chargement de xterm");
          return;
        }

        Terminal = mod.Terminal;
        terminal.current = new Terminal({
          cursorBlink: true,
          rows: 25,
          cols: 80,
          fontSize: fontSize,
          theme: theme,
        });

        if (termRef.current) {
          terminal.current.open(termRef.current);
          terminal.current.writeln("🔗 Connexion au serveur...");
        }

        const ws = new WebSocket(`ws://localhost:8080`);
        ws.onopen = () => {
          terminal.current?.writeln("\r\n✅ Connecté au serveur Aiscaler !");
        };

        ws.onmessage = (event) => {
          // Essayer de parser le message en JSON
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "lens" && msg.url) {
              setLensUrl(msg.url);
              terminal.current?.writeln(`\r\n🔗 URL de Lens reçue : ${msg.url}`);
            } else if (msg.type === "output" && msg.data) {
              terminal.current?.write(msg.data.replace(/\n/g, "\r\n"));
            } else {
              terminal.current?.write(event.data.replace(/\n/g, "\r\n"));
            }
          } catch (error) {
            // Si le message n'est pas du JSON, l'afficher dans le terminal
            terminal.current?.write(event.data.replace(/\n/g, "\r\n"));
          }
        };

        terminal.current?.onData((data) => {
          ws.send(data);
        });

        ws.onclose = () => {
          terminal.current?.writeln("\r\n🔴 Déconnecté du serveur Aiscaler!");
        };

        ws.onerror = (error) => {
          console.error("Erreur WebSocket :", error);
        };

        wsRef.current = ws;
      })
      .catch((err) => console.error("Erreur lors de l'importation de xterm :", err));

    return () => {
      wsRef.current?.close();
      terminal.current?.dispose();
    };
  }, [fontSize, theme]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Barre de personnalisation */}
      <div
        style={{
          padding: "1rem",
          backgroundColor: "#f5f5f5",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
        }}
      >
        <label>
          Taille de police:
          <input
            type="number"
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value) || 14)}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
        <label>
          Couleur de fond:
          <input
            type="color"
            value={theme.background}
            onChange={(e) => setTheme({ ...theme, background: e.target.value })}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
        <label>
          Couleur de texte:
          <input
            type="color"
            value={theme.foreground}
            onChange={(e) =>
              setTheme({ ...theme, foreground: e.target.value })
            }
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
        <button onClick={toggleFullScreen} style={{ marginLeft: "auto" }}>
          {isFullScreen ? "Quitter le plein écran" : "Plein écran"}
        </button>
      </div>

      {/* Conteneur du terminal */}
      <div
        ref={termRef}
        style={{
          flex: 1,
          width: "100%",
          backgroundColor: theme.background,
          border: "1px solid #ccc",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      />

      {/* Affichage de Lens : on affiche l'URL reçue  pour s'y connecter*/}
      {lensUrl && (
        <div style={{ padding: "1rem", background: "#f0f0f0" }}>
          <h2>Interface Lens</h2>
          {/* Option 1 : Affichage dans une iframe */}
          <iframe
            src={lensUrl}
            style={{ width: "100%", height: "600px", border: "none" }}
            title="Lens Dashboard"
          ></iframe>
          {/* Option 2 : Lien cliquable */}
          <p>
            Ou accéder directement via{" "}
            <a href={lensUrl} target="_blank" rel="noopener noreferrer">
              ce lien
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
