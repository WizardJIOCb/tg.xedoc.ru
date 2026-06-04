# TG Hunter

Safe Telegram growth workspace for public-channel research, lead scoring, opt-in campaign planning, CRM, reports, and compliance controls.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm dev
```

The local dev server uses `127.0.0.1:5177`.

## Domain

Production Docker serves the built app on internal port `80`. The included `docker-compose.yml` binds it to `127.0.0.1:3010`, so Caddy or nginx can publish it as `tg.xedoc.ru` without exposing a new public host port directly.
