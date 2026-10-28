# Build stage
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

# TARGETOS and TARGETARCH are automatically set by Docker buildx
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=0.9.0

WORKDIR /app


# Copy go.mod and go.sum first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build the binary
# We explicitly set GOARCH to TARGETARCH to ensure we build for the target platform
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X cove/backend/internal/version.Version=$VERSION" -o cove-server ./cmd/server

# Run stage
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
# ffmpeg also provides ffprobe; both are used for video messages (transcoding and duration).
RUN apk add --no-cache ca-certificates ffmpeg

# Copy the binary from the builder stage
COPY --from=builder /app/cove-server .

# Create directory for data persistence
RUN mkdir -p /app/data

# Expose HTTP and UDP ports
EXPOSE 4000 9090/udp

# Command to run the application
CMD ["./cove-server"]
