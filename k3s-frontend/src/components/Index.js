"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import "@/styles/globals.css";

const Index = () => {
  const router = useRouter();

  return (
    <div className="landing-container">
      <header className="landing-header">
        <h1 className="landing-title">Kubernetes Virtuel via AiScaler</h1>
        <p className="landing-subtitle">
          Déployez et gérez vos clusters Kubernetes en toute simplicité.
        </p>
      </header>

      <main className="landing-main">
        <div className="landing-left">
          <Image
            className="landing-image"
            src="/servers.jpg"
            alt="Kubernetes"
            width={500}
            height={300}
            priority
          />
        </div>

        <div className="landing-right">
          <h2 className="landing-headline">Gestion Simplifiée de Kubernetes</h2>
          <p className="landing-description">
            Avec AiScaler, créez, gérez et surveillez vos clusters Kubernetes directement depuis votre navigateur.
          </p>
          <div className="landing-buttons">
            <button onClick={() => router.push("/terminal")}>Accéder a Kubernetes</button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
