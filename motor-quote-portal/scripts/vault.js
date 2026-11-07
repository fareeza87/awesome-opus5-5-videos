// Manage portal passwords kept in the encrypted vault.
//   npm run vault -- list
//   npm run vault -- show etiqa        print the current password (to log in by hand)
//   npm run vault -- set etiqa         set it after a reset by email (asks for it)
import { createInterface } from 'node:readline/promises';
import * as vault from '../providers/rpa/vault.js';

const [cmd, id] = process.argv.slice(2);
if (cmd === 'list') {
  console.table(vault.list());
} else if (cmd === 'show' && id) {
  const p = vault.getPasswords(id);
  if (!p) console.log(`No saved password for ${id}; the bot uses the one in the environment.`);
  else console.log(`current: ${p.current}${p.pending ? `\npending (not yet confirmed): ${p.pending}` : ''}\nchanged: ${p.changedAt}`);
} else if (cmd === 'set' && id) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = (await rl.question(`New password for ${id}: `)).trim();
  rl.close();
  if (!pw) process.exit(1);
  vault.setPassword(id, pw);
  console.log('Saved.');
} else {
  console.log('Usage: npm run vault -- list | show <insurer-id> | set <insurer-id>');
}
