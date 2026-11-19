# systemd user unit

`piencoder.service` runs piencoder as a systemd user service.

Expected layout (relative to the service user's home, `%h`):

- app checkout (built, with `dist/`): `~/apps/piencoder`
- environment file: `~/apps/piencoder.env` (all settings and secrets live here, never in git)
- Node.js: `~/.local/bin/node`

Install:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/piencoder.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now piencoder
loginctl enable-linger "$USER"   # once, so it runs without a login session
```

Status and logs: `systemctl --user status piencoder`, `journalctl --user -u piencoder -f`.
