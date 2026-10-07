// Code node: "Prepare this week"
//
// Splits the stored feedback into the current period and the one before it,
// does all the counting, and builds the list the AI model will see.

const settings = $('Digest settings').first().json;
const days = Math.max(1, Number(settings.lookbackDays) || 7);
const maxItems = Math.max(1, Number(settings.maxItems) || 200);
const MAX_CHARS = 600; // longest feedback text sent to the model

const now = $now; // current time in the workflow timezone
const periodStart = now.minus({ days });
const previousStart = now.minus({ days: days * 2 });

// Email addresses and long digit runs (phone numbers) are masked here, before any
// text is sent to the model or published. The stored rows keep the original text.
const mask = (text) =>
  text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (match) =>
      match.replace(/\D/g, '').length >= 9 ? '[number removed]' : match,
    );

// One clean record per stored row. Rows without text or a readable date are dropped.
const rows = $input
  .all()
  .map((item) => item.json)
  .filter((row) => row && row.id !== undefined && String(row.feedback ?? '').trim() !== '')
  .map((row) => ({
    id: Number(row.id),
    time: new Date(row.submitted_at).getTime(),
    rating: Number(row.rating),
    area: String(row.area ?? '').trim() || 'Not specified',
    text: mask(String(row.feedback).replace(/\s+/g, ' ').trim()),
  }))
  .filter((row) => Number.isFinite(row.time));

const current = rows
  .filter((row) => row.time >= periodStart.toMillis())
  .sort((a, b) => b.time - a.time); // newest first
const previous = rows.filter(
  (row) => row.time >= previousStart.toMillis() && row.time < periodStart.toMillis(),
);

const summarise = (list) => {
  const ratings = list.map((row) => Math.round(row.rating)).filter((r) => r >= 1 && r <= 5);
  const ratingSplit = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratings.forEach((r) => {
    ratingSplit[r] += 1;
  });
  const total = ratings.reduce((sum, r) => sum + r, 0);
  return {
    count: list.length,
    averageRating: ratings.length ? Math.round((total / ratings.length) * 10) / 10 : null,
    ratingSplit,
  };
};

// The model gets at most maxItems items, newest first, with long texts shortened.
const sent = current.slice(0, maxItems);
const forModel = sent.map((row) => ({
  id: row.id,
  rating: row.rating,
  area: row.area,
  text: row.text.length > MAX_CHARS ? row.text.slice(0, MAX_CHARS) + '…' : row.text,
}));

const startFormat = periodStart.year === now.year ? 'd LLL' : 'd LLL yyyy';

return [
  {
    json: {
      productName: String(settings.productName ?? '').trim() || 'Product',
      period: {
        days,
        from: periodStart.toISO(),
        to: now.toISO(),
        label: `${periodStart.toFormat(startFormat)} – ${now.toFormat('d LLL yyyy')}`,
        fileDate: now.toFormat('yyyy-LL-dd'),
        generatedAt: now.toFormat('d LLL yyyy, HH:mm'),
        timezone: now.zoneName,
      },
      current: summarise(current),
      previous: summarise(previous),
      // Full records for the current period. "Build digest" takes counts and quotes from here.
      items: current.map(({ id, rating, area, text }) => ({ id, rating, area, text })),
      sentToModel: sent.length,
      notSentToModel: current.length - sent.length,
      feedbackJson: JSON.stringify(forModel, null, 1),
    },
  },
];
