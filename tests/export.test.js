const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildExportRows, toCsv } = require("../public/export");

// All tests pin tzOffsetMin = 0 (UTC) so local-time-of-day math is deterministic.
const TZ = 0;
// A wide range covering the whole day of 2026-06-28 (UTC).
const DAY = {
  fromTs: Date.UTC(2026, 5, 28, 0, 0, 0),
  toTs: Date.UTC(2026, 5, 29, 0, 0, 0),
};

function round(timeUtc, votes) {
  return { id: timeUtc, createdAt: timeUtc, votes };
}

function note(startMin, endMin, title, url = "") {
  return { id: `${startMin}-${endMin}`, startMin, endMin, title, url };
}

test("a note window with one vote round produces one matched row", () => {
  const agenda = [note(540, 555, "Standup", "https://x/1")]; // 09:00-09:15
  const history = [
    round("2026-06-28T09:05:00.000Z", [
      { name: "Alice", value: "5" },
      { name: "Bob", value: "3" },
    ]),
  ];

  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  assert.deepEqual(rows, [
    {
      start: "09:00",
      end: "09:15",
      title: "Standup",
      url: "https://x/1",
      estimations: "Alice: 5, Bob: 3",
    },
  ]);
});

test("two rounds in one note window produce two rows with the same title/url", () => {
  const agenda = [note(600, 630, "Login flow", "https://x/2")]; // 10:00-10:30
  const history = [
    round("2026-06-28T10:20:00.000Z", [{ name: "Bob", value: "8" }]),
    round("2026-06-28T10:05:00.000Z", [{ name: "Alice", value: "5" }]),
  ];

  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  assert.equal(rows.length, 2);
  // chronological within the window
  assert.deepEqual(rows[0], {
    start: "10:00",
    end: "10:30",
    title: "Login flow",
    url: "https://x/2",
    estimations: "Alice: 5",
  });
  assert.deepEqual(rows[1], {
    start: "10:00",
    end: "10:30",
    title: "Login flow",
    url: "https://x/2",
    estimations: "Bob: 8",
  });
});

test("a note with no votes produces one row with empty estimations", () => {
  const agenda = [note(720, 735, "Empty topic", "")]; // 12:00-12:15
  const rows = buildExportRows([], agenda, { ...DAY, tzOffsetMin: TZ });

  assert.deepEqual(rows, [
    { start: "12:00", end: "12:15", title: "Empty topic", url: "", estimations: "" },
  ]);
});

test("a vote matching no note becomes a disconnected row (blank title/url, no end)", () => {
  const history = [
    round("2026-06-28T14:32:00.000Z", [{ name: "Carol", value: "13" }]),
  ];
  const rows = buildExportRows(history, [], { ...DAY, tzOffsetMin: TZ });

  assert.deepEqual(rows, [
    { start: "14:32", end: "", title: "", url: "", estimations: "Carol: 13" },
  ]);
});

test("votes outside the picked range are excluded", () => {
  const agenda = [note(0, 1440, "All day", "")];
  const history = [
    round("2026-06-27T23:00:00.000Z", [{ name: "Late", value: "1" }]), // day before
    round("2026-06-29T01:00:00.000Z", [{ name: "After", value: "2" }]), // day after
    round("2026-06-28T12:00:00.000Z", [{ name: "InRange", value: "3" }]),
  ];

  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].estimations, "InRange: 3");
});

test("a null vote value renders as '-'", () => {
  const agenda = [note(540, 600, "Topic", "")];
  const history = [
    round("2026-06-28T09:30:00.000Z", [
      { name: "Alice", value: null },
      { name: "Bob", value: "5" },
    ]),
  ];
  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });
  assert.equal(rows[0].estimations, "Alice: -, Bob: 5");
});

test("rows are ordered chronologically with disconnected votes interleaved", () => {
  const agenda = [note(600, 630, "Ten", ""), note(840, 900, "Two", "")]; // 10:00, 14:00
  const history = [
    round("2026-06-28T14:10:00.000Z", [{ name: "C", value: "2" }]), // in "Two"
    round("2026-06-28T12:00:00.000Z", [{ name: "B", value: "9" }]), // disconnected @ 12:00
    round("2026-06-28T10:10:00.000Z", [{ name: "A", value: "1" }]), // in "Ten"
  ];

  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  assert.deepEqual(
    rows.map((r) => [r.start, r.title, r.estimations]),
    [
      ["10:00", "Ten", "A: 1"],
      ["12:00", "", "B: 9"],
      ["14:00", "Two", "C: 2"],
    ],
  );
});

test("empty inputs produce no rows", () => {
  assert.deepEqual(buildExportRows([], [], { ...DAY, tzOffsetMin: TZ }), []);
});

// --- Dated agenda entries: older days are kept and exported by their own day ---

function dnote(day, startMin, endMin, title) {
  return { id: `${day}-${startMin}`, startMin, endMin, title, url: "", day };
}

test("exporting an older day returns that day's agenda entries, not today's", () => {
  const agenda = [
    dnote("2026-06-28", 540, 555, "Old standup"), // the day we export
    dnote("2026-06-29", 540, 555, "Today standup"), // a later day
  ];
  const history = [
    round("2026-06-28T09:05:00.000Z", [{ name: "Ada", value: "8" }]),
    round("2026-06-29T09:05:00.000Z", [{ name: "Lin", value: "3" }]),
  ];

  // DAY covers 2026-06-28 only.
  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  assert.deepEqual(
    rows.map((r) => [r.title, r.estimations]),
    [["Old standup", "Ada: 8"]],
    "older export keeps the old day's note+votes and excludes the later day",
  );
});

test("a round pairs with the note from its OWN day, not another day's same window", () => {
  const agenda = [
    dnote("2026-06-28", 600, 630, "Mon review"),
    dnote("2026-06-29", 600, 630, "Tue review"),
  ];
  const history = [round("2026-06-28T10:15:00.000Z", [{ name: "Ada", value: "5" }])];

  const rows = buildExportRows(history, agenda, { ...DAY, tzOffsetMin: TZ });

  // Only Monday is in range; the vote attaches to Monday's note, and Tuesday's
  // note (out of range) never appears.
  assert.deepEqual(
    rows.map((r) => [r.title, r.estimations]),
    [["Mon review", "Ada: 5"]],
  );
});

test("toCsv emits a header and quotes fields with commas, quotes, or newlines", () => {
  const rows = [
    { start: "09:00", end: "09:15", title: "Plain", url: "", estimations: "A: 5" },
    {
      start: "10:00",
      end: "10:30",
      title: 'Has, comma and "quote"',
      url: "https://x/a,b",
      estimations: "A: 5, B: 3",
    },
  ];

  const csv = toCsv(rows);
  const lines = csv.split("\r\n");

  assert.equal(lines[0], "start,end,title,url,estimations");
  assert.equal(lines[1], "09:00,09:15,Plain,,A: 5");
  assert.equal(
    lines[2],
    '10:00,10:30,"Has, comma and ""quote""","https://x/a,b","A: 5, B: 3"',
  );
});
