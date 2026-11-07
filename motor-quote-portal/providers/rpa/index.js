// RPA connector: runs the insurer's bot on its logged-in portal session.
import { runBot } from './pool.js';
import mockPortal from './bots/mock-portal.js';
import po from './bots/po.js';
import allianz from './bots/allianz.js';
import ikhlas from './bots/ikhlas.js';

// Register one bot per insurer portal here.
const BOTS = {
  'mock-portal': mockPortal,
  po,
  allianz,
  ikhlas,
};

function botFor(provider) {
  const bot = BOTS[provider.rpa?.bot];
  if (!bot) throw new Error(`No RPA bot "${provider.rpa?.bot}" registered in providers/rpa/index.js`);
  return bot;
}

export function quoteViaRpa(provider, req) {
  const bot = botFor(provider);
  return runBot(provider, bot, (page, creds) => bot.quote(page, req, creds));
}

export function lookupViaRpa(provider, req) {
  const bot = botFor(provider);
  return runBot(provider, bot, (page, creds) => bot.lookup(page, req, creds));
}
