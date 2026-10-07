// Code node: "Build digest"
//
// Turns the model's answer into the published digest. The model only says which
// feedback ids belong together and describes each group. Every count, rating and
// quote below is taken from the stored feedback, so the digest cannot contain
// invented numbers or invented quotes.

const settings = $('Digest settings').first().json;
const prep = $('Prepare this week').first().json;
const answer = $input.first().json.output ?? {};

const minMentions = Math.max(1, Number(settings.minMentions) || 2);
const includeQuotes = String(settings.includeQuotes) !== 'false';
const QUOTE_CHARS = 240; // longest quote shown
const MAX_OTHER = 10; // most ungrouped items listed

// ---- Text helpers ----------------------------------------------------------
// Customer text and model text are both treated as untrusted: whitespace is
// collapsed, links are removed and Markdown / HTML characters are escaped.
const tidy = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi, '[link removed]')
    .trim();
const shorten = (text, max) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);
const md = (text) => tidy(text).replace(/&/g, '&amp;').replace(/([\\`*_[\]<>|~])/g, '\\$1');
const html = (text) =>
  tidy(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const oneDecimal = (n) => (n === null || n === undefined ? 'n/a' : Number(n).toFixed(1));
const signed = (n, digits = 0) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(digits);
const average = (items) => {
  const ratings = items.map((item) => Math.round(item.rating)).filter((r) => r >= 1 && r <= 5);
  if (!ratings.length) return null;
  return Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10;
};

const TYPE_LABELS = {
  bug: 'Bug',
  feature_request: 'Feature request',
  usability: 'Usability',
  performance: 'Performance',
  pricing: 'Pricing',
  praise: 'Praise',
  other: 'Other',
};
const typeLabel = (value) =>
  TYPE_LABELS[
    String(value ?? '')
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_')
  ] ?? 'Other';

// ---- Check the model's answer against the stored feedback --------------------
// Only the items that were actually sent to the model can be placed in a theme.
const analysed = prep.items.slice(0, prep.sentToModel);
const byId = new Map(analysed.map((item) => [item.id, item]));
const used = new Set();
let ignoredIds = 0; // ids from the model that do not exist or were already placed
const themes = [];

for (const raw of Array.isArray(answer.themes) ? answer.themes : []) {
  const ids = [];
  for (const value of Array.isArray(raw?.feedback_ids) ? raw.feedback_ids : []) {
    const id = Number(value);
    if (!byId.has(id) || used.has(id) || ids.includes(id)) {
      ignoredIds += 1;
      continue;
    }
    ids.push(id);
  }
  // Too small to be a theme: its items are reported under "Other feedback".
  if (ids.length < minMentions) continue;

  ids.forEach((id) => used.add(id));
  const items = ids.map((id) => byId.get(id));
  const quoteId = ids.includes(Number(raw.quote_id)) ? Number(raw.quote_id) : ids[0];

  themes.push({
    name: shorten(tidy(raw.name) || 'Unnamed theme', 80),
    type: typeLabel(raw.type),
    summary: shorten(tidy(raw.summary), 500),
    action: shorten(tidy(raw.suggested_action), 300),
    count: items.length,
    share: Math.round((items.length / prep.current.count) * 100),
    averageRating: average(items),
    quote: byId.get(quoteId),
  });
}

// Most mentioned first; ties go to the lower average rating.
themes.sort((a, b) => b.count - a.count || (a.averageRating ?? 9) - (b.averageRating ?? 9));
const others = analysed.filter((item) => !used.has(item.id));

// ---- Numbers for the summary table -----------------------------------------
const cur = prep.current;
const prev = prep.previous;
const countChange = signed(cur.count - prev.count);
const ratingChange =
  cur.averageRating === null || prev.averageRating === null
    ? 'n/a'
    : signed(Math.round((cur.averageRating - prev.averageRating) * 10) / 10, 1);
const quoteLine = (item) => {
  const rated = item.rating >= 1 && item.rating <= 5 ? `, rated ${item.rating}/5` : '';
  return `“${md(shorten(tidy(item.text), QUOTE_CHARS))}” (feedback #${item.id}${rated})`;
};

// ---- Markdown digest -------------------------------------------------------
const lines = [
  `# Feedback digest: ${prep.period.label}`,
  '',
  `**${md(prep.productName)}** · ${plural(cur.count, 'feedback item')} in the last ${plural(prep.period.days, 'day')}`,
  '',
];

const headline = shorten(tidy(answer.headline), 300);
if (headline) lines.push(`> ${md(headline)}`, '');

lines.push(
  '## At a glance',
  '',
  '| | This period | Previous period | Change |',
  '|:--|--:|--:|--:|',
  `| Feedback received | ${cur.count} | ${prev.count} | ${countChange} |`,
  `| Average rating (out of 5) | ${oneDecimal(cur.averageRating)} | ${oneDecimal(prev.averageRating)} | ${ratingChange} |`,
  '',
  `Ratings this period: ${[5, 4, 3, 2, 1].map((r) => `${r}★ × ${cur.ratingSplit[r] ?? 0}`).join(' · ')}`,
  '',
  '## Themes',
  '',
);

if (themes.length === 0) {
  lines.push(`No topic was raised by at least ${plural(minMentions, 'customer')} this period.`, '');
} else {
  lines.push(
    '| # | Theme | Type | Mentions | Share | Avg rating |',
    '|--:|:--|:--|--:|--:|--:|',
    ...themes.map(
      (t, i) =>
        `| ${i + 1} | ${md(t.name)} | ${t.type} | ${t.count} | ${t.share}% | ${oneDecimal(t.averageRating)} |`,
    ),
    '',
  );
  themes.forEach((t, i) => {
    lines.push(
      `### ${i + 1}. ${md(t.name)}`,
      '',
      `${t.type} · ${plural(t.count, 'mention')} (${t.share}%) · average rating ${oneDecimal(t.averageRating)}`,
      '',
    );
    if (t.summary) lines.push(md(t.summary), '');
    if (t.action) lines.push(`**Suggested next step:** ${md(t.action)}`, '');
    if (includeQuotes) lines.push(`> ${quoteLine(t.quote)}`, '');
  });
}

if (others.length > 0) {
  lines.push(
    '## Other feedback',
    '',
    `${plural(others.length, 'item')} did not fit a theme.`,
    '',
  );
  if (includeQuotes) {
    others.slice(0, MAX_OTHER).forEach((item) => lines.push(`- ${quoteLine(item)}`));
    if (others.length > MAX_OTHER) lines.push(`- and ${others.length - MAX_OTHER} more`);
    lines.push('');
  }
}

lines.push(
  '---',
  '',
  `*How this was made: an AI model grouped the feedback into themes and wrote the headline, summaries and suggested next steps. Counts, ratings and quotes come directly from the stored feedback. Generated on ${prep.period.generatedAt} (${prep.period.timezone}).*`,
);
if (prep.notSentToModel > 0) {
  lines.push(
    '',
    `*Note: ${plural(prep.notSentToModel, 'older item')} exceeded the per-run limit and did not go to the model. The table at the top still counts everything received.*`,
  );
}
if (ignoredIds > 0) {
  lines.push(
    '',
    `*Note: ${plural(ignoredIds, 'feedback id')} returned by the model could not be used (unknown, or already placed in a theme) and had no effect on the digest.*`,
  );
}
const markdown = lines.join('\n') + '\n';

// ---- Where the digest goes -------------------------------------------------
const owner = String(settings.githubOwner ?? '').trim();
const repo = String(settings.githubRepo ?? '').trim();
const branch = String(settings.branch ?? '').trim() || 'main';
const folder = String(settings.digestFolder ?? '')
  .trim()
  .replace(/^\/+|\/+$/g, '');
const filePath = `${folder ? folder + '/' : ''}${prep.period.fileDate}.md`;
const digestUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath
  .split('/')
  .map(encodeURIComponent)
  .join('/')}`;

// ---- Short summary for Telegram (HTML) ---------------------------------------
const telegram = [
  `<b>Feedback digest: ${html(prep.period.label)}</b>`,
  html(prep.productName),
  '',
  `${plural(cur.count, 'item')} (${countChange} vs previous period) · average rating ${oneDecimal(cur.averageRating)} (${ratingChange})`,
  '',
];
if (themes.length > 0) {
  telegram.push('Top themes:');
  themes
    .slice(0, 3)
    .forEach((t, i) => telegram.push(`${i + 1}. ${html(t.name)}: ${plural(t.count, 'mention')}`));
  telegram.push('');
}
telegram.push(`<a href="${digestUrl}">Read the full digest</a>`);

return [
  {
    json: {
      owner,
      repo,
      branch,
      filePath,
      digestUrl,
      commitMessage: `Feedback digest ${prep.period.label}: ${plural(cur.count, 'item')}, ${plural(themes.length, 'theme')}`,
      markdown,
      telegramText: telegram.join('\n'),
      themeCount: themes.length,
      otherCount: others.length,
      ignoredIds,
    },
  },
];
