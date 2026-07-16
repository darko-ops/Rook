import { db } from '@rook/db';

/**
 * 2026 F1 calendar (round, GP name, race Sunday). Times are nominal 13:00
 * UTC race / 14:00 UTC Saturday quali — the calendar drives beta cadence
 * and race-day/non-race-day metrics, not timing-critical logic.
 * Verify dates against the official calendar before the public launch.
 */
export const F1_2026_CALENDAR: Array<{ round: number; name: string; raceDate: string }> = [
  { round: 1, name: 'Australian GP', raceDate: '2026-03-08' },
  { round: 2, name: 'Chinese GP', raceDate: '2026-03-15' },
  { round: 3, name: 'Japanese GP', raceDate: '2026-03-29' },
  { round: 4, name: 'Bahrain GP', raceDate: '2026-04-12' },
  { round: 5, name: 'Saudi Arabian GP', raceDate: '2026-04-19' },
  { round: 6, name: 'Miami GP', raceDate: '2026-05-03' },
  { round: 7, name: 'Canadian GP', raceDate: '2026-05-24' },
  { round: 8, name: 'Monaco GP', raceDate: '2026-06-07' },
  { round: 9, name: 'Spanish GP (Barcelona)', raceDate: '2026-06-14' },
  { round: 10, name: 'Austrian GP', raceDate: '2026-06-28' },
  { round: 11, name: 'British GP', raceDate: '2026-07-05' },
  { round: 12, name: 'Belgian GP', raceDate: '2026-07-19' },
  { round: 13, name: 'Hungarian GP', raceDate: '2026-07-26' },
  { round: 14, name: 'Dutch GP', raceDate: '2026-08-23' },
  { round: 15, name: 'Italian GP', raceDate: '2026-09-06' },
  { round: 16, name: 'Madrid GP', raceDate: '2026-09-13' },
  { round: 17, name: 'Azerbaijan GP', raceDate: '2026-09-27' },
  { round: 18, name: 'Singapore GP', raceDate: '2026-10-11' },
  { round: 19, name: 'United States GP (Austin)', raceDate: '2026-10-25' },
  { round: 20, name: 'Mexico City GP', raceDate: '2026-11-01' },
  { round: 21, name: 'São Paulo GP', raceDate: '2026-11-08' },
  { round: 22, name: 'Las Vegas GP', raceDate: '2026-11-21' },
  { round: 23, name: 'Qatar GP', raceDate: '2026-11-29' },
  { round: 24, name: 'Abu Dhabi GP', raceDate: '2026-12-06' },
];

export async function seedRaces(seasonId: number): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of F1_2026_CALENDAR) {
    const race = new Date(`${r.raceDate}T13:00:00Z`);
    const quali = new Date(race.getTime() - 23 * 3600e3); // Saturday 14:00 UTC
    await sql`
      insert into races (season_id, round, name, quali_at, race_at)
      values (${seasonId}, ${r.round}, ${r.name}, ${quali}, ${race})
      on conflict (season_id, round) do nothing
    `;
    n++;
  }
  return n;
}

/**
 * A "race day" for metrics purposes is any day of a race weekend
 * (Friday–Sunday around the race). §18's non-race-day open rate uses this.
 */
export async function raceDaySet(seasonId: number): Promise<Set<string>> {
  const sql = db();
  const races = await sql`select race_at from races where season_id = ${seasonId}`;
  const days = new Set<string>();
  for (const r of races) {
    const race = new Date(r.race_at).getTime();
    for (let d = -2; d <= 0; d++) {
      days.add(new Date(race + d * 86400e3).toISOString().slice(0, 10));
    }
  }
  return days;
}

export async function nextRace(seasonId: number, now: Date) {
  const rows = await db()`
    select round, name, quali_at, race_at from races
    where season_id = ${seasonId} and race_at > ${now}
    order by race_at limit 1
  `;
  return rows[0] ?? null;
}
