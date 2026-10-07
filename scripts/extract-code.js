#!/usr/bin/env node
// Writes readable copies of the logic that lives inside the workflow file:
// the Code nodes go to code/, the prompt and output schema go to prompts/.
//
// The workflow JSON is the source of truth. After changing a Code node or the
// prompt in n8n, export the workflow over workflows/feedback-insights-digest.json
// and run:  node scripts/extract-code.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'workflows', 'feedback-insights-digest.json'), 'utf8'),
);
const node = (name) => {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`Node "${name}" not found in the workflow file`);
  return found;
};
const write = (file, text) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text.replace(/\s+$/, '') + '\n');
  console.log('wrote', file);
};

write('code/prepare-this-week.js', node('Prepare this week').parameters.jsCode);
write('code/build-digest.js', node('Build digest').parameters.jsCode);
write('code/sample-feedback.js', node('Sample feedback').parameters.jsCode);

const chain = node('Group into themes').parameters;
write('prompts/system.md', chain.messages.messageValues[0].message);
write('prompts/user.md', chain.text.replace(/^=/, ''));
write('prompts/output-schema.json', node('Theme format').parameters.inputSchema);
