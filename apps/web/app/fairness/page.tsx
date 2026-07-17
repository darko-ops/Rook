import { houseShareByDay, loadConfig } from '@rook/core';
import { activeSeason } from '../../lib/session';

export const dynamic = 'force-dynamic';

/** Disclosed mechanics are fair mechanics (§10). Published from day one. */
export default async function FairnessPage() {
  const season = await activeSeason();
  const cfg = await loadConfig(new Date());
  const shares = season ? await houseShareByDay(season.id, 7) : [];
  const byDay = new Map<string, { house: number; organic: number }>();
  for (const s of shares) {
    const day = new Date(s.day).toISOString().slice(0, 10);
    const rec = byDay.get(day) ?? { house: 0, organic: 0 };
    rec.house += s.house_impact ?? 0;
    rec.organic += s.organic_impact ?? 0;
    byDay.set(day, rec);
  }

  return (
    <>
      <header style={{ padding: '22px 0 4px' }}>
        <h1>How prices work</h1>
        <div className="faint" style={{ fontSize: 13 }}>Rook shouldn&apos;t be right. Rook should be fair.</div>
      </header>

      <div style={{ display: 'grid', gap: 12, marginTop: 16, fontSize: 14.5, lineHeight: 1.6 }}>
        <section className="panel">
          <strong>The market sets every price.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Each team trades on a simple bonding curve: price = base + slope ×
            shares outstanding. Buying moves the price up, selling moves it
            down. Rook never sets a target price for any team — the algorithm
            computes everything except value.
          </p>
        </section>
        <section className="panel">
          <strong>Every price change is traceable to trades.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            The trade log is append-only. Any price at any time can be
            reconstructed from it. Whale trades are surfaced on each market
            screen, not hidden.
          </p>
        </section>
        <section className="panel">
          <strong>The house mover: disclosed, capped, decaying.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            To keep thin markets alive overnight, a house account makes small
            trades in the direction of classified news — direction only, never
            toward a target price. Its trades are flagged in the log, capped at
            a fraction of any day&apos;s move, rate-limited, and its influence
            decays to zero as real trading volume grows. It has no P&amp;L
            objective.
          </p>
          {byDay.size > 0 && (
            <table className="sheet" style={{ marginTop: 10 }}>
              <tbody>
                {[...byDay.entries()].slice(0, 7).map(([day, r]) => {
                  const total = r.house + r.organic;
                  return (
                    <tr key={day}>
                      <td className="muted num">{day}</td>
                      <td className="num">
                        house share of price movement: {total > 0 ? `${((100 * r.house) / total).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <strong>How seasons settle.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            {cfg.settlement.mode === 'standings' ? (
              <>
                Each asset pays a fixed, published amount by its <em>final
                championship position</em> — P1 teams settle at
                ${cfg.settlement.teamPayouts[0]!.toFixed(2)}, last place at
                ${cfg.settlement.teamPayouts[cfg.settlement.teamPayouts.length - 1]!.toFixed(2)}
                {' '}(drivers likewise, ${cfg.settlement.driverPayouts[0]!.toFixed(2)} down to
                ${cfg.settlement.driverPayouts[cfg.settlement.driverPayouts.length - 1]!.toFixed(2)}).
                The sport decides positions; the market prices the
                probability all season; Rook still sets nothing. The full
                table is shown on every asset page.
              </>
            ) : (
              <>
                Each asset settles at its time-weighted average market price
                over the final week of the season — last-minute manipulation
                washes out, and sentiment is the measure end-to-end.
              </>
            )}
          </p>
        </section>
        <section className="panel">
          <strong>Equal stacks. No top-ups. Ever.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Every player gets the same $10,000 of play money each season. You
            cannot buy more. The only way to have more is to trade better —
            the leaderboard means something because of this.
          </p>
        </section>
        <section className="panel">
          <strong>Play money, all the way down.</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            No cash in, no cash out, no prizes for entry fees. Rook Score is
            reputation, not winnings.
          </p>
        </section>
      </div>
    </>
  );
}
