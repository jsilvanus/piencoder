# piencoder

Hardware streaming encoder controller microservice for the Raspberry Pi production ecosystem at Riihimäen Keskuskirkko.

> **Ecosystem Status Requirement**  
> All updates to this repository's status, service contracts, port allocations, or operational health MUST be documented in the centralized [piecosystem](https://github.com/keskuskirkko/piecosystem) registry.

---

## Overview

`piencoder` controls and monitors physical hardware streaming encoders (such as the Matrox Monarch HDX dual-channel encoder) over local network HTTP/HTTPS APIs. It isolates vendor-specific retry handling, busy queueing, and polling loops from the central gateway, supporting multiple encoder units simultaneously.

## Features

- **Multi-Encoder Architecture**: Manage one or more physical encoder appliances (`encoder 1`, `encoder 2`, etc.).
- **Dual Channel / Dual Stream Support**: Start, stop, and configure individual channels (`encoder1`, `encoder2`) or `both`.
- **Busy Retry Queueing**: Robust command serialization to handle Matrox Monarch firmware `RETRY` responses.
- **REST & SSE Endpoints**: Real-time event streaming and REST control on port `3104`.

## API Endpoints

- `GET /health` & `GET /api/v1/health`
- `GET /events` & `GET /api/v1/events` (SSE stream)
- `GET /api/v1/encoders` or `GET /api/v1/encoder`: List all configured encoders (`{ items: [...] }`)
- `GET /api/v1/encoder/:number`: Status of encoder `:number`
- `POST /api/v1/encoder/:number/start`: Start encoder `:number` (`{ channel: 1 | 2 | "both" }`)
- `POST /api/v1/encoder/:number/stop`: Stop encoder `:number`
- `GET /api/v1/encoder/:number/input`: Video/audio lock status
- `GET /api/v1/encoder/:number/settings`: Bitrate, input selection, filename
- `PUT /api/v1/encoder/:number/settings`: Update settings
- `PUT /api/v1/encoder/:number/rtmp/:channel`: Configure RTMP destination

## License

ISC
