// Pure, side-effect-free builders for the "Export notes + votes" CSV feature.
// Shared between the browser (window.ScrumExport) and node tests (module.exports).
//
// Matching is intentionally dumb/best-effort: a vote round belongs to a note iff
// the round's LOCAL time-of-day falls in the note's [startMin, endMin). Votes that
// match no note become disconnected rows; notes with no votes keep an empty
// estimations cell.
(function (root) {
  "use strict";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function minutesToHHMM(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  }

  // Local time-of-day (minutes from local midnight) for an ISO timestamp.
  // tzOffsetMin follows Date#getTimezoneOffset(): minutes that local is BEHIND UTC
  // (e.g. UTC+2 → -120). Defaults to the runtime's own offset when omitted.
  function localMinutes(iso, tzOffsetMin) {
    const t = new Date(iso).getTime();
    const offset =
      typeof tzOffsetMin === "number" ? tzOffsetMin : new Date(t).getTimezoneOffset();
    const local = new Date(t - offset * 60000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
  }

  // Local calendar day (YYYY-MM-DD) for a timestamp, same offset convention as
  // localMinutes. Used to pair a vote round with the agenda note from its OWN day.
  function localDay(ts, tzOffsetMin) {
    const t = new Date(ts).getTime();
    const offset =
      typeof tzOffsetMin === "number" ? tzOffsetMin : new Date(t).getTimezoneOffset();
    return new Date(t - offset * 60000).toISOString().slice(0, 10);
  }

  function estimationsOf(votes) {
    return (votes || [])
      .map((v) => `${v.name}: ${v.value == null ? "-" : v.value}`)
      .join(", ");
  }

  // history: room.voteHistory ; agenda: room.agenda
  // opts: { fromTs, toTs (epoch ms, inclusive), tzOffsetMin?, tickets? }
  // tickets (optional): room.tickets. Each confirmed ticket becomes its own row
  // (title, link, its votes) at the time it was confirmed, and the round it was
  // confirmed with is left out of the plain rounds so it is not listed twice.
  function buildExportRows(history, agenda, opts) {
    opts = opts || {};
    const { fromTs, toTs, tzOffsetMin } = opts;

    const inRange = (ts) => {
      const t = new Date(ts).getTime();
      if (typeof fromTs === "number" && t < fromTs) return false;
      if (typeof toTs === "number" && t > toTs) return false;
      return true;
    };

    // Agenda notes carry a `day` (YYYY-MM-DD). Keep a note if its day falls in
    // the export window; legacy notes with no day are kept (best-effort, old
    // behaviour). This is what lets an older report pull that day's entries.
    const fromDay = typeof fromTs === "number" ? localDay(fromTs, tzOffsetMin) : null;
    // toTs is an exclusive end (the picker defaults to next-day midnight), so the
    // last included day is the instant just before it — else a midnight bound
    // would pull in the following day's entries.
    const toDay = typeof toTs === "number" ? localDay(toTs - 1, tzOffsetMin) : null;
    const dayInRange = (day) => {
      if (!day) return true;
      if (fromDay && day < fromDay) return false;
      if (toDay && day > toDay) return false;
      return true;
    };

    const ticketState = opts.tickets || {};
    const confirmed = Array.isArray(ticketState.done) ? ticketState.done : [];
    const usedRounds = new Set([
      ...(Array.isArray(ticketState.usedRoundIds) ? ticketState.usedRoundIds : []),
      ...confirmed.map((t) => t.roundId).filter(Boolean),
    ]);

    const rounds = (history || [])
      .filter((r) => !usedRounds.has(r.id))
      .filter((r) => inRange(r.createdAt))
      .map((r) => ({
        ts: new Date(r.createdAt).getTime(),
        min: localMinutes(r.createdAt, tzOffsetMin),
        day: localDay(r.createdAt, tzOffsetMin),
        estimations: estimationsOf(r.votes),
      }))
      .sort((a, b) => a.ts - b.ts);

    const notes = (agenda || [])
      .filter((n) => dayInRange(n.day))
      .slice()
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    // Assign each round to the first note window it falls into — but only a note
    // from the round's OWN day (legacy day-less notes still match any day).
    const matched = new Map(); // note -> rounds[]
    const disconnected = [];
    for (const round of rounds) {
      const owner = notes.find(
        (n) =>
          (!n.day || n.day === round.day) &&
          round.min >= n.startMin &&
          round.min < n.endMin,
      );
      if (owner) {
        if (!matched.has(owner)) matched.set(owner, []);
        matched.get(owner).push(round);
      } else {
        disconnected.push(round);
      }
    }

    const rows = [];

    for (const n of notes) {
      const base = {
        start: minutesToHHMM(n.startMin),
        end: minutesToHHMM(n.endMin),
        title: n.title || "",
        url: n.url || "",
      };
      const hits = matched.get(n);
      if (hits && hits.length) {
        for (const r of hits) {
          rows.push({ ...base, estimations: r.estimations, _sort: n.startMin });
        }
      } else {
        rows.push({ ...base, estimations: "", _sort: n.startMin });
      }
    }

    for (const r of disconnected) {
      rows.push({
        start: minutesToHHMM(r.min),
        end: "",
        title: "",
        url: "",
        estimations: r.estimations,
        _sort: r.min,
      });
    }

    for (const t of confirmed) {
      if (!t.confirmedAt || !inRange(t.confirmedAt)) continue;
      const min = localMinutes(t.confirmedAt, tzOffsetMin);
      rows.push({
        start: minutesToHHMM(min),
        end: "",
        title: t.title || "",
        url: t.link || "",
        estimations: estimationsOf(t.votes),
        _sort: min,
      });
    }

    // Stable sort keeps within-window rounds in chronological order.
    rows.sort((a, b) => a._sort - b._sort);
    return rows.map(({ _sort, ...row }) => row);
  }

  const CSV_COLUMNS = ["start", "end", "title", "url", "estimations"];

  function escapeCsv(value) {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(rows) {
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of rows || []) {
      lines.push(CSV_COLUMNS.map((col) => escapeCsv(row[col])).join(","));
    }
    return lines.join("\r\n");
  }

  const api = { buildExportRows, toCsv, minutesToHHMM, localMinutes };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ScrumExport = api;
})(typeof window !== "undefined" ? window : null);
