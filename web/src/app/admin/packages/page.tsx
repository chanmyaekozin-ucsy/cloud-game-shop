"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatKs, salePriceKs } from "@/lib/format";
import type { Game, Package } from "@/lib/types";

export default function AdminPackagesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [gameId, setGameId] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [priceKs, setPriceKs] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<Package[]>([]);
  listRef.current = packages;

  const reload = () =>
    api<{ packages: Package[] }>(`/api/admin/packages?gameId=${gameId}`).then((r) =>
      setPackages(r.packages),
    );

  useEffect(() => {
    api<{ games: Game[] }>("/api/admin/games")
      .then((g) => {
        setGames(g.games);
        if (g.games[0]) setGameId(g.games[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  useEffect(() => {
    if (!gameId) return;
    reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [gameId]);

  const patch = async (id: string, body: Partial<Package>) => {
    setError("");
    try {
      await api(`/api/admin/packages/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const persistOrder = async (next: Package[]) => {
    setPackages(next);
    try {
      await api("/api/admin/packages/reorder", {
        method: "POST",
        body: JSON.stringify({ gameId, ids: next.map((p) => p.id) }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save order");
      await reload().catch(() => undefined);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= packages.length) return;
    const next = [...packages];
    const current = next[index];
    const swap = next[to];
    if (!current || !swap) return;
    next[index] = swap;
    next[to] = current;
    void persistOrder(next);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/packages", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          name,
          displayName: name,
          priceKs: Number(priceKs),
        }),
      });
      setName("");
      setPriceKs("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h2>Packages</h2>
          <p>Drag to reorder, or use the arrows on laptop. Shop follows this order.</p>
        </div>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <div className="toolbar">
        <select className="box" value={gameId} onChange={(e) => setGameId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <form className="toolbar" onSubmit={add}>
        <input className="box" placeholder="Package name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="box"
          placeholder="Price Ks"
          value={priceKs}
          onChange={(e) => setPriceKs(e.target.value.replace(/\D/g, ""))}
        />
        <button className="btn small" type="submit">
          Add
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Name</th>
              <th>Original</th>
              <th>% off</th>
              <th>- Ks</th>
              <th>Sale</th>
              <th>Featured</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg, index) => (
              <tr
                key={pkg.id}
                className={dragging === pkg.id ? "dragging" : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  const fromId = dragging;
                  if (!fromId || fromId === pkg.id) return;
                  const next = [...listRef.current];
                  const from = next.findIndex((p) => p.id === fromId);
                  const to = next.findIndex((p) => p.id === pkg.id);
                  if (from < 0 || to < 0) return;
                  const [item] = next.splice(from, 1);
                  if (!item) return;
                  next.splice(to, 0, item);
                  setPackages(next);
                }}
              >
                <td>
                  <div className="sort-cell">
                    <button
                      className="sort-handle"
                      type="button"
                      aria-label="Drag to reorder"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", pkg.id);
                        setDragging(pkg.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        void persistOrder(listRef.current);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                      </svg>
                    </button>
                    <div className="sort-arrows">
                      <button
                        className="sort-arrow"
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        className="sort-arrow"
                        type="button"
                        aria-label="Move down"
                        disabled={index === packages.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </td>
                <td>
                  <input
                    className="box"
                    defaultValue={pkg.displayName}
                    onBlur={(e) => {
                      if (e.target.value !== pkg.displayName) {
                        void patch(pkg.id, { displayName: e.target.value });
                      }
                    }}
                  />
                </td>
                <td>
                  <input
                    className="box"
                    defaultValue={String(pkg.priceKs)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== pkg.priceKs) void patch(pkg.id, { priceKs: n });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="box"
                    style={{ width: 72 }}
                    defaultValue={String(pkg.offPercent || 0)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== (pkg.offPercent || 0)) void patch(pkg.id, { offPercent: n });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="box"
                    style={{ width: 88 }}
                    defaultValue={String(pkg.offKs || 0)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== (pkg.offKs || 0)) void patch(pkg.id, { offKs: n });
                    }}
                  />
                </td>
                <td>
                  <b>{formatKs(salePriceKs(pkg))}</b>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={pkg.featured}
                    onChange={(e) => void patch(pkg.id, { featured: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={pkg.isActive}
                    onChange={(e) => void patch(pkg.id, { isActive: e.target.checked })}
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
