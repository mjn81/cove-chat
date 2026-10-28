---
title: Binary install
description: Run the Cove server as a plain executable or a system service.
---

Download the server zip for your platform from the [latest release](https://github.com/mjn81/cove-chat/releases/latest). Each zip contains one executable.

| Platform | Asset |
|---|---|
| Linux (amd64) | `cove-server-linux-amd64.zip` |
| Windows (amd64) | `cove-server-windows-amd64.zip` |
| macOS Intel / Apple silicon | `cove-server-darwin-amd64.zip` / `cove-server-darwin-arm64.zip` |

## Run it

```bash
unzip cove-server-linux-amd64.zip
curl -o config.toml https://raw.githubusercontent.com/mjn81/cove-chat/main/backend/config.toml.example
chmod +x cove-server-linux-amd64
./cove-server-linux-amd64
```

The server reads `config.toml` from the working directory. Set `COVE_CONFIG` to use another path. On first start it generates a master password and writes it to the file: **back it up**.

:::tip[Video messages]
Install `ffmpeg` (it includes `ffprobe`) so uploaded videos are converted to MP4. The Docker image already has it. See [Requirements](../requirements/#about-ffmpeg).
:::

:::note
The binary serves the API and WebSocket only. Serve the web client separately: use the `mjn81/cove-webclient` image, or build `client-web` and put `dist/` behind any static web server. See [Web client](../../clients/web/).
:::

## systemd service (Linux)

```ini title="/etc/systemd/system/cove.service"
[Unit]
Description=Cove server
After=network-online.target
Wants=network-online.target

[Service]
User=cove
WorkingDirectory=/opt/cove
ExecStart=/opt/cove/cove-server
Restart=on-failure
# Keep the master password out of config.toml if you prefer:
# Environment=COVE_MASTER_PASSWORD=...

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/cove cove
sudo chown -R cove:cove /opt/cove
sudo systemctl enable --now cove
journalctl -u cove -f
```

## Windows

Run `cove-server-windows-amd64.exe` from a folder containing `config.toml`. To run it as a service, wrap it with a tool such as NSSM or WinSW and set the working directory to that folder.
