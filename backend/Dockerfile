# Build stage
FROM golang:1.26-alpine AS builder

# TARGETOS and TARGETARCH are automatically set by Docker buildx
ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go.mod and go.sum first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build the binary
# We explicitly set GOARCH to TARGETARCH to ensure we build for the target platform
RUN CGO_ENABLED=1 GOOS=linux GOARCH=$TARGETARCH go build -o nodetalk-server ./cmd/server

# Run stage
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Copy the binary from the builder stage
COPY --from=builder /app/nodetalk-server .

# Create directory for data persistence
RUN mkdir -p /app/data

# Expose HTTP and UDP ports
EXPOSE 4000 9090/udp

# Command to run the application
CMD ["./nodetalk-server"]
