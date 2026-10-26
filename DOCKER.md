# Cove Docker Guide

This guide explains how to run Cove using Docker and Docker Compose.

## 1. Quick Start with Docker Compose

The easiest way to get started is using Docker Compose.

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Deployment
1. Clone the repository.
2. Run the following command in the root directory:
   ```bash
   docker-compose up -d
   ```
3. Open your browser and navigate to `http://localhost:3000`.

> [!TIP]
> For a production-ready setup using pre-built images, check out the [Production Example](./examples/docker-compose/production/).

---

## 2. Configuration

Cove prioritizes configuration via the `config.toml` file.

### Using config.toml (Recommended)
1. Ensure `backend/config.toml` exists (copy from `config.toml.example`).
2. The `docker-compose.yml` automatically mounts this file into the container.
3. Any changes made to `backend/config.toml` on your host will be picked up by the server on restart.

### Frontend Environment Variables
While the backend uses a file, the web client (frontend) uses an environment variable to know where the API is located:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_API_URL` | The public URL of your backend API | `http://localhost:8080` |

> [!TIP]
> For production, set `VITE_API_URL` to your public domain (e.g., `https://api.nodetalk.app`).

---

## 3. Manual Build and Run

### Backend
```bash
cd backend
docker build -t nodetalk-server:latest .
docker run -p 8080:8080 -p 9090:9090/udp -v ./data:/app/data nodetalk-server:latest
```

### Web Client
```bash
cd client-web
docker build -t nodetalk-webclient:latest .
docker run -p 3000:80 -e VITE_API_URL=http://your-backend-ip:8080 nodetalk-webclient:latest
```

---

## 4. Pushing to Docker Hub

If you want to share your images on Docker Hub:

```bash
# Tag images
docker tag nodetalk-server:latest yourusername/nodetalk-server:latest
docker tag nodetalk-webclient:latest yourusername/nodetalk-webclient:latest

# Push images
docker push yourusername/nodetalk-server:latest
docker push yourusername/nodetalk-webclient:latest
```
