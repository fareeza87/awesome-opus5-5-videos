// For bots that already run in your RPA tool (UiPath, Power Automate, etc.).
// The portal POSTs the request to the bot's HTTP trigger and waits for the
// quote. The bot must reply with the same quote shape as rateQuote() returns.
//   <PROVIDER_ID>_RPA_URL   the bot's HTTP trigger
//   <PROVIDER_ID>_RPA_KEY   optional bearer token

export async function quoteViaWebhook(provider, req, kind = 'quote') {
  const prefix = provider.id.toUpperCase().replace(/-/g, '_');
  const url = process.env[`${prefix}_RPA_URL`];
  if (!url) throw new Error(`RPA bot URL not set (${prefix}_RPA_URL)`);
  const key = process.env[`${prefix}_RPA_KEY`];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ kind, insurer: provider.id, request: req }),
  });
  if (!res.ok) throw new Error(`RPA bot returned ${res.status}`);
  return res.json();
}
