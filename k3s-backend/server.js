const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const Docker = require("dockerode");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const net = require("net");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const docker = new Docker();

// Stockage des sessions par sessionId
const sessions = new Map();

/**
 * Retourne un port libre sur la machine.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

/**
 * Génère un identifiant unique pour la session.
 */
function generateUniqueId() {
  return Date.now().toString() + Math.floor(Math.random() * 10000).toString();
}

/**
 * Génère un fichier kubeconfig pour la session en pointant vers le conteneur K3s.
 * Pour Google Cloud, remplace "YOUR_INSTANCE_IP" par l'IP appropriée ou utilise une variable d'environnement.
 */
function generateKubeConfig(sessionId, k3sPort) {
  const instanceIP = process.env.INSTANCE_IP || "YOUR_INSTANCE_IP";
  const kubeconfig = `
apiVersion: v1
kind: Config
clusters:
- name: k3s
  cluster:
    server: https://${instanceIP}:${k3sPort}
    insecure-skip-tls-verify: true
contexts:
- name: k3s
  context:
    cluster: k3s
    user: admin
current-context: k3s
users:
- name: admin
  user:
    token: admin-token
  `;
  const kubeconfigPath = path.join(__dirname, `kubeconfig-${sessionId}.yaml`);
  fs.writeFileSync(kubeconfigPath, kubeconfig);
  console.log(`✅ Kubeconfig generated for session ${sessionId} at ${kubeconfigPath}`);
  return kubeconfigPath;
}

/**
 * Génère un fichier de configuration pour Lens (attendu dans /buddy/config.json).
 */
function generateLensConfig(sessionId) {
  const lensConfig = {
    preferences: {
      theme: "dark",
      fontSize: 12
    },
    clusters: [
      {
        name: "k3s",
        kubeconfig: "/kubeconfig.yaml"
      }
    ],
    extensions: [],
    ts: [] // Fournir un tableau vide pour éviter l'erreur "ts is null"
  };

  const lensConfigPath = path.join(__dirname, `lens-config-${sessionId}.json`);
  fs.writeFileSync(lensConfigPath, JSON.stringify(lensConfig, null, 2));
  console.log(`✅ Lens config generated for session ${sessionId} at ${lensConfigPath}`);
  return lensConfigPath;
}

/**
 * Route simple pour vérifier le status du backend.
 */
app.get("/status", (req, res) => {
  res.json({ status: "K3s Cluster Manager is running" });
});

/**
 * Route pour télécharger le kubeconfig d'une session donnée.
 */
app.get("/get-kubeconfig/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session || !fs.existsSync(session.kubeconfigPath)) {
    return res.status(404).json({ error: "Kubeconfig not found for this session" });
  }
  res.download(session.kubeconfigPath);
});

/**
 * WebSocket : pour chaque connexion, on crée un conteneur K3s et un conteneur Lens dédiés.
 */
wss.on("connection", async (ws) => {
  const sessionId = generateUniqueId();
  console.log(`🖥️ New WebSocket connection, sessionId: ${sessionId}`);

  try {
    // 1️⃣ Obtenir un port libre pour exposer l'API Kubernetes du conteneur K3s.
    const k3sPort = await getFreePort();

    // Créer le conteneur K3s pour la session.
    const k3sContainer = await docker.createContainer({
      Image: "rancher/k3s",
      name: `k3s-${sessionId}`,
      Cmd: ["server"],
      Tty: true,
      OpenStdin: true,
      StdinOnce: false,
      HostConfig: {
        PortBindings: {
          "6443/tcp": [{ HostPort: `${k3sPort}` }],
        },
        Privileged: true,
      },
    });
    await k3sContainer.start();
    console.log(`✅ K3s container started for session ${sessionId} on port ${k3sPort}`);

    // Attendre quelques secondes pour que le cluster K3s soit opérationnel.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 2️⃣ Générer le fichier kubeconfig pour cette session.
    const kubeconfigPath = generateKubeConfig(sessionId, k3sPort);

    // 3️⃣ Générer le fichier de configuration pour Lens.
    const lensConfigPath = generateLensConfig(sessionId);

    // 4️⃣ Obtenir un port libre pour exposer le conteneur Lens.
    const lensPort = await getFreePort();

    // Créer le conteneur Lens en montant le kubeconfig et la config Lens.
    const lensContainer = await docker.createContainer({
      Image: "buddy/lens:latest",
      name: `lens-${sessionId}`,
      HostConfig: {
        PortBindings: {
          "3000/tcp": [{ HostPort: `${lensPort}` }],
        },
        Binds: [
          `${kubeconfigPath}:/kubeconfig.yaml`,
          `${lensConfigPath}:/buddy/config.json`
        ],
      },
    });
    await lensContainer.start();
    console.log(`✅ Lens container started for session ${sessionId} on port ${lensPort}`);

    // Stocker les infos de la session pour le nettoyage ultérieur.
    sessions.set(sessionId, {
      k3sContainer,
      lensContainer,
      kubeconfigPath,
      lensConfigPath,
      lensPort,
      k3sPort,
    });

    // Envoyer l'URL d'accès à Lens au client.
    ws.send(JSON.stringify({ type: "lens", url: `http://localhost:${lensPort}` }));

    // 5️⃣ Optionnel : lancer un shell interactif dans le conteneur K3s.
    const exec = await k3sContainer.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ["/bin/sh"],
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    stream.on("data", (data) => {
      ws.send(JSON.stringify({ type: "output", data: data.toString() }));
    });
    ws.on("message", (message) => {
      stream.write(message);
    });

    // À la déconnexion, nettoyer la session.
    ws.on("close", async () => {
      console.log(`🔴 Client disconnected, cleaning up session ${sessionId}`);
      const session = sessions.get(sessionId);
      if (session) {
        try {
          await session.k3sContainer.stop();
          await session.k3sContainer.remove();
          console.log(`✔️ K3s container for session ${sessionId} removed`);
        } catch (err) {
          console.error("Error stopping K3s container:", err);
        }
        try {
          await session.lensContainer.stop();
          await session.lensContainer.remove();
          console.log(`✔️ Lens container for session ${sessionId} removed`);
        } catch (err) {
          console.error("Error stopping Lens container:", err);
        }
        // Supprimer les fichiers générés.
        if (fs.existsSync(session.kubeconfigPath)) {
          fs.unlinkSync(session.kubeconfigPath);
          console.log(`✔️ Kubeconfig for session ${sessionId} removed`);
        }
        if (fs.existsSync(session.lensConfigPath)) {
          fs.unlinkSync(session.lensConfigPath);
          console.log(`✔️ Lens config for session ${sessionId} removed`);
        }
        sessions.delete(sessionId);
      }
    });
  } catch (error) {
    console.error("❌ Error setting up session:", error);
    ws.send(JSON.stringify({ type: "error", message: error.message }));
    ws.close();
  }
});

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
