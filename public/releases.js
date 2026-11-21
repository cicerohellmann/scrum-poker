// Release notes shown in the in-app "What's new" dialog. Newest first.
// To publish an update, prepend a new entry: { version, date, title, items }.
window.SCRUM_RELEASES = [
  {
    version: "1.2",
    date: "2026-07-10",
    title: "Teams — color and group your table",
    items: [
      "Teams: the room owner can create teams, each with its own color.",
      "The room owner can set each team’s visibility — a hidden team doesn’t sit at the table or count toward the vote.",
      "Players can now pick a team — it groups and sorts the table, and keeps the “voted” count clear when there are multiple teams.",
      "Room settings is now scrollable.",
    ],
  },
  {
    version: "1.1",
    date: "2026-07-09",
    title: "Edit your rooms, cleaner history",
    items: [
      "Rename a room or change its password after creating it — look for the Edit button on rooms you made.",
      "History saves a round the moment you reveal (even a single vote) and only lists people who actually voted.",
      "Exporting an older day now brings back that day’s agenda notes, not today’s.",
      "The agenda board starts collapsed and remembers whether you keep it open or closed.",
    ],
  },
  {
    version: "1.0",
    date: "2026-06-28",
    title: "First release",
    items: [
      "Password-protected planning rooms with shareable invite links.",
      "Stable per-browser identity — no duplicate seats, and you appear as Name#1234.",
      "“Your rooms” landing: one-tap, password-free rejoin for 14 days, with room- and session-expiry countdowns.",
      "Room History — rooms you left or that expired stay one tap away, each clearable.",
      "Leave actually frees your seat for everyone.",
      "Round-table Scrum Poker with hidden votes, clean reveals, and a free-number “N” card.",
      "Previous-votes history with average, range, and most-picked.",
      "Shared Agenda notepad: a live time rail with notes you edit in a floating editor, link out, drag, and resize.",
      "Export Agenda notes correlated with vote rounds to a CSV.",
      "Hidden Texas Hold’em mode — seats only present players and auto-folds anyone who drops mid-hand.",
      "Day/night theme, mobile-friendly layout, and rooms that persist for 12 weeks.",
    ],
  },
];
