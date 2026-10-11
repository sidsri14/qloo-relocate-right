"use client";

import { FormEvent, useState } from "react";

import type { RelocationResult } from "@/lib/relocation";

function splitValues(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function Home() {
  const [interests, setInterests] = useState("independent coffee, live jazz, science fiction");
  const [cities, setCities] = useState("Berlin, Lisbon, Toronto");
  const [result, setResult] = useState<RelocationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/relocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interests: splitValues(interests),
          cities: splitValues(cities),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The comparison failed");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The comparison failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Qloo-grounded relocation agent</p>
        <h1>Choose a city that fits your life, not only your job.</h1>
        <p className="lede">
          RelocateRight resolves your real taste signals, compares candidate destinations
          through Qloo&apos;s cultural graph, and leaves legal and financial decisions explicit.
        </p>
      </section>

      <section className="workspace">
        <form onSubmit={submit}>
          <label htmlFor="interests">Interests, comma separated</label>
          <textarea
            id="interests"
            value={interests}
            onChange={(event) => setInterests(event.target.value)}
            rows={3}
          />
          <small>Use 1-5 concrete tastes: artists, films, food styles, or places.</small>

          <label htmlFor="cities">Candidate cities, comma separated</label>
          <textarea
            id="cities"
            value={cities}
            onChange={(event) => setCities(event.target.value)}
            rows={3}
          />
          <small>Compare 2-5 destinations. Visa eligibility is intentionally not inferred.</small>

          <button disabled={loading} type="submit">
            {loading ? "Comparing..." : "Run taste comparison"}
          </button>
        </form>

        <div className="results" aria-live="polite">
          {!result && !error && (
            <div className="empty">
              <span>01</span>
              <p>Your ranked evidence will appear here.</p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {result && (
            <>
              <div className="resultHeader">
                <h2>Ranked destinations</h2>
                <span className={`source ${result.source}`}>{result.source} data</span>
              </div>
              <div className="resolved" role="group" aria-label="Resolved taste signals">
                <span>
                  {result.source === "qloo" ? "Resolved by Qloo" : "Mock-resolved fixtures"}
                </span>
                {result.resolvedInterests.map((interest) => (
                  <code key={interest.id}>{interest.name}</code>
                ))}
              </div>
              <ol>
                {result.rankings.map((item) => (
                  <li key={item.entityId}>
                    <div>
                      <strong>{item.city}</strong>
                      <p>{item.reasons.join(" · ") || "Ranked from Qloo affinity order"}</p>
                    </div>
                    <b>
                      {item.affinity === null ? `#${item.rank}` : item.affinity.toFixed(2)}
                      {item.affinity !== null && <small>affinity</small>}
                    </b>
                  </li>
                ))}
              </ol>
              <p className="caveat">{result.caveat}</p>
              <details>
                <summary>Workflow trace</summary>
                {result.trace.map((step) => (
                  <p key={step}>{step}</p>
                ))}
              </details>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
