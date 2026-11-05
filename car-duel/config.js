// Where the game sends its Claude calls: the Cloudflare Worker in
// worker/claude-proxy.js, which holds the API key. Paste its URL here.
window.CAR_DUEL_CONFIG = {
  proxyUrl: 'https://car-duel-proxy.car-duel-proxy.workers.dev'
};
