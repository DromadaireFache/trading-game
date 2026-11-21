The headline catalog is built offline with `lfm3-1.7b` on `sbb-server-01`. The generator starts with move-specific events, varies them with actual industry beats, and gives the model a choice of complete headline forms. The grammar keeps the economic result intact. It exhausts new story premises before reusing one with a different setting, and defaults to a roughly one-third comedy mix. It checks each result for schema violations and duplicates, then publishes completed batches atomically. Rerunning resumes the existing catalog.

```bash
npm run generate-headlines -- --dry-run
npm run generate-headlines -- --per-bucket 3
npm run generate-headlines -- --per-bucket 50  # targets 10,500 generated headlines
npm run generate-headlines -- --scope stock --sector airlines --direction down --count 12 --out /tmp/airline-headlines.json
npm run pull-headlines
```

The default API is `http://100.79.118.13:8080/v1/chat/completions`. Override it with `HEADLINES_API_URL` and set `HEADLINES_MODEL` to select another llama.cpp model. `HEADLINES_API_KEY` is optional. The request batches default to 12 briefs. Use `--help` for filters. Category filters only select buckets with a compatible catalyst. Default generation covers ordinary news, including neutral stories. The seed also contains earnings leaks, fake news, debunks and event templates.

The installed systemd user timer checks coverage daily on the home server and calls the local model only when there are gaps. Its target is three exact hits in each of 210 ordinary-news buckets: ten legal move combinations each for the market, ten named sectors, and stocks in those ten sectors. The service runs in `~/.local/share/trading-game-headlines/app` and writes `shared/data/headlines.generated.json` there. The units in [systemd](systemd/) use the isolated Node runtime under `~/.local/share/trading-game-headlines/runtime`.

```bash
ssh sbb-server-01 'systemctl --user list-timers trading-game-headlines.timer'
ssh sbb-server-01 'journalctl --user -u trading-game-headlines.service -n 25 --no-pager'
```

`npm run pull-headlines` validates a remote snapshot and replaces the local generated catalog. Use `--out` for separate local generation runs you want to keep. A process killed before cleanup may leave a `.lock` file beside its catalog. Remove the lock only after checking the PID inside it is no longer running.

The game server loads the bundled seed and generated snapshot when it starts, and passes them to the news engine for each new game. Set `TG_HEADLINES_PATH` to load a different generated file. The news engine matches the affected stock's sector or the affected sector, along with scope, direction, magnitude, and kind. Generic seed entries remain eligible. It fills company and CEO slots from the game universe. The catalog is a startup snapshot, so restart the server after pulling a new file.
