# Cove Deployment Examples

This directory contains example configurations for deploying Cove in different environments.

## Available Examples

### 1. [Production (Docker Compose)](./docker-compose/production/)
A standalone setup using pre-built images from Docker Hub. Ideal for quick production deployments without needing to build from source.

*   **Images Used**: `mjn81/cove-server` and `mjn81/cove-webclient`.
*   **Requirements**: Docker and Docker Compose.
*   **Setup**: Just copy the `docker-compose.yml` and `config.toml`, then run `docker-compose up -d`.

### 2. [Bot (Go)](./bot-go/)
A small bot using the [Bot API](../docs/bots-api.md): slash commands, interactions, buttons, the action menu, and both the gateway and signed webhooks.

---

For development instructions and building from source, refer to the [main README](../README.md) and [DOCKER.md](../DOCKER.md).
