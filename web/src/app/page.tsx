"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShopShell } from "@/components/ShopShell";
import { api } from "@/lib/api";
import type { Game } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ games: Game[] }>("/api/games")
      .then((data) => setGames(data.games))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load games"));
  }, []);

  const filtered = games.filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <ShopShell>
      <div className="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search games"
          aria-label="Search games"
        />
      </div>
      <div className="pad">
        <div className="section-kicker">Games</div>
        {error ? <p className="err">{error}</p> : null}
        {filtered.length === 0 ? (
          <p className="empty">No games match that search.</p>
        ) : (
          <div className="game-grid">
            {filtered.map((game) => (
              <button
                key={game.id}
                className="game-tile"
                type="button"
                onClick={() => router.push(`/play/${game.slug}`)}
              >
                <span className="game-art">
                  <span className="game-icon">
                    <img src={game.icon} alt="" />
                  </span>
                  {game.tag ? (
                    <span className={`badge ${game.tag}`}>{game.tag.toUpperCase()}</span>
                  ) : null}
                </span>
                <span className="game-label">{game.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </ShopShell>
  );
}
