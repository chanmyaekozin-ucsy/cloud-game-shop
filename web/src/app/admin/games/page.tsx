"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Game, GameTag } from "@/lib/types";

export default function AdminGamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    api<{ games: Game[] }>("/api/admin/games").then((r) => setGames(r.games));

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  const uploadLogo = async (id: string, file: File) => {
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/admin/games/${id}/icon`, { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not update logo");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update logo");
    }
  };

  const patch = async (id: string, body: Partial<Game>) => {
    setError("");
    try {
      await api(`/api/admin/games/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Games</h2>
          <p>Active games show in the shop. Click a logo to change it. Tags are Hot or Promo.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Game</th>
              <th>Tag</th>
              <th>Active</th>
              <th>Sort</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id}>
                <td>
                  <div className="game-cell">
                    <label className="game-logo">
                      <img src={game.icon} alt="" />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void uploadLogo(game.id, file);
                        }}
                      />
                    </label>
                    <div>
                      <b>{game.name}</b>
                      <div className="muted">{game.slug}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    className="box"
                    value={game.tag ?? ""}
                    onChange={(e) => {
                      const tag = (e.target.value || null) as GameTag;
                      void patch(game.id, { tag });
                    }}
                  >
                    <option value="">None</option>
                    <option value="hot">Hot</option>
                    <option value="promo">Promo</option>
                  </select>
                </td>
                <td>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={game.isActive}
                      onChange={(e) => void patch(game.id, { isActive: e.target.checked })}
                    />
                    {game.isActive ? "On" : "Off"}
                  </label>
                </td>
                <td>
                  <input
                    className="box"
                    type="number"
                    style={{ width: 80 }}
                    value={game.sortOrder}
                    onChange={(e) => void patch(game.id, { sortOrder: Number(e.target.value) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
