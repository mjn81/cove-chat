.PHONY: version/sync version/check site/install site/dev site/gen site/build site/typecheck site/lint android/compile android/build android/install help build run dev dev-back dev-front front/dev front/install front/build front/test front/lint front/typecheck wails/dev wails/build wails/build/mac wails/build/windows wails/build/linux backend/release release swagger test tidy lint clean docker/build docker/push

release: clean backend/release wails/build/mac wails/build/windows wails/build/linux ## Build and package ALL assets for release
	./scripts/package_release.sh


GOBIN := $(HOME)/go/bin
GO    := go
PNPM  := pnpm
BIN   := cove-server
VERSION := $(shell cat VERSION)
LDFLAGS := -s -w -X cove/backend/internal/version.Version=$(VERSION)

help: ## Show this help
	@grep -E '^[a-zA-Z_/-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

## ── Backend ──────────────────────────────────────────────────────────────────
version/sync: ## Propagate VERSION into web + desktop manifests
	node scripts/sync-version.mjs

version/check: ## Fail if manifests drift from VERSION
	node scripts/sync-version.mjs --check

tidy: ## go mod tidy
	cd backend && $(GO) mod tidy

build: ## Build standalone web server binary
	cd backend && $(GO) build -ldflags "$(LDFLAGS)" -o ../$(BIN) ./cmd/server

dev dev-back run: export GO_ENV := development
dev dev-back run: export NODE_ENV := development

dev-back: ## Run standalone backend in dev mode (go run)
	cd backend && $(GO) run ./cmd/server

run: dev-back ## Run standalone backend (alias for dev-back)

test: ## Run all tests with race detector
	cd backend && $(GO) test ./... -race -cover -count=1

lint: ## Run golangci-lint (via go run, no install needed)
	cd backend && $(GO) run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest run ./...

swagger: ## Regenerate Swagger docs (runs swag via go run, no install needed)
	cd backend && $(GO) run github.com/swaggo/swag/cmd/swag@v1.16.6 init -g cmd/server/main.go --output docs --parseDependency

## ── Frontend ─────────────────────────────────────────────────────────────────
front/install: ## Install web client deps (pnpm, frozen lockfile)
	$(PNPM) -C client-web install --frozen-lockfile

dev-front: ## Run frontend dev server (Vite)
	$(PNPM) -C client-web dev

front/dev: dev-front ## Vite dev server (alias for dev-front)

front/build: ## Build production bundle into client-web/dist/
	$(PNPM) -C client-web build

front/test: ## Run frontend unit tests (Vitest)
	$(PNPM) -C client-web test

front/lint: ## Run ESLint on the web client
	$(PNPM) -C client-web lint

front/typecheck: ## Type-check the web client (tsc, no emit)
	$(PNPM) -C client-web typecheck

## ── Website (landing + docs) ───────────────────────────────────────────────
site/install: ## Install website deps (pnpm, frozen lockfile)
	$(PNPM) -C website install --frozen-lockfile

site/dev: ## Run the website dev server (Astro)
	$(PNPM) -C website dev

site/gen: ## Regenerate the config + API reference pages from the backend
	$(PNPM) -C website gen

site/build: ## Build the website into website/dist/ (regenerates references first)
	$(PNPM) -C website build

site/typecheck: ## Type-check the website (astro check)
	$(PNPM) -C website typecheck

site/lint: ## Run ESLint on the website
	$(PNPM) -C website lint

## ── Android ─────────────────────────────────────────────────────────────────
# Gradle 8.11 cannot start on JDK 24+ (Android Studio now bundles JDK 25), so builds are pinned to a JDK 17-23.
# Auto-detected from ~/.jdks and Program Files; override with `make android/build ANDROID_JDK=/path/to/jdk`.
ANDROID_JDK ?= $(firstword $(wildcard $(HOME)/.jdks/jbr-21* $(HOME)/.jdks/jbr-17* $(HOME)/.jdks/openjdk-21* $(HOME)/.jdks/temurin-21* $(HOME)/.jdks/corretto-21* /c/Program Files/Java/jdk-21* /c/Program Files/Java/jdk-17* /usr/lib/jvm/java-21-openjdk* /usr/lib/jvm/java-17-openjdk*))

android/compile: ## Compile the Android client (Kotlin only, fast check)
	@test -n "$(ANDROID_JDK)" || (echo "No JDK 17-23 found; install one or pass ANDROID_JDK=..."; exit 1)
	cd client-android && JAVA_HOME="$(ANDROID_JDK)" ./gradlew :app:compileDebugKotlin

android/build: ## Build the Android debug APK
	@test -n "$(ANDROID_JDK)" || (echo "No JDK 17-23 found; install one or pass ANDROID_JDK=..."; exit 1)
	cd client-android && JAVA_HOME="$(ANDROID_JDK)" ./gradlew :app:assembleDebug

android/install: ## Build and install the debug APK on the connected device/emulator
	@test -n "$(ANDROID_JDK)" || (echo "No JDK 17-23 found; install one or pass ANDROID_JDK=..."; exit 1)
	cd client-android && JAVA_HOME="$(ANDROID_JDK)" ./gradlew :app:installDebug

## ── Wails Desktop (PRIMARY build target) ────────────────────────────────────
wails/dev: build ## Run Wails in dev mode (hot-reload desktop app)
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	touch client-desktop/frontend/dist/.gitkeep
	cd client-desktop && $(GOBIN)/wails dev -s

wails/build: build front/build ## Build production Wails desktop binary
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	touch client-desktop/frontend/dist/.gitkeep
	cd client-desktop && $(GOBIN)/wails build -clean -s

wails/build/mac: build front/build ## Build macOS universal binary
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	touch client-desktop/frontend/dist/.gitkeep
	cd client-desktop && $(GOBIN)/wails build -clean -platform darwin/universal -s

wails/build/windows: build front/build ## Build Windows binary (amd64)
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	touch client-desktop/frontend/dist/.gitkeep
	cd client-desktop && $(GOBIN)/wails build -clean -platform windows/amd64 -s

wails/build/linux: build front/build ## Build Linux binary (amd64)
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	touch client-desktop/frontend/dist/.gitkeep
	cd client-desktop && $(GOBIN)/wails build -clean -platform linux/amd64 -s

backend/release: ## Build backend binaries for multiple platforms
	mkdir -p release/backend
	GOOS=linux   GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o release/backend/cove-server-linux-amd64 backend/cmd/server/main.go
	GOOS=darwin  GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o release/backend/cove-server-darwin-amd64 backend/cmd/server/main.go
	GOOS=darwin  GOARCH=arm64 $(GO) build -ldflags "$(LDFLAGS)" -o release/backend/cove-server-darwin-arm64 backend/cmd/server/main.go
	GOOS=windows GOARCH=amd64 $(GO) build -ldflags "$(LDFLAGS)" -o release/backend/cove-server-windows-amd64.exe backend/cmd/server/main.go
	@echo "Backend binaries built in release/backend/"

## ── Docker ───────────────────────────────────────────────────────────────────
docker/setup: ## Create and switch to a multi-platform builder
	docker buildx create --name cove-builder --use || docker buildx use cove-builder
	docker buildx inspect --bootstrap

docker/build: ## Build production Docker images locally
	docker-compose build --pull

docker/build-multi: ## Build and push multi-platform Docker images (usage: make docker/build-multi DOCKER_USER=name)
	@if [ -z "$(DOCKER_USER)" ]; then echo "Error: DOCKER_USER is required."; exit 1; fi
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_USER)/cove-server:latest --push ./backend
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_USER)/cove-webclient:latest --push ./client-web

docker/push: docker/build ## Push images to Docker Hub (usage: make docker/push DOCKER_USER=name)
	@if [ -z "$(DOCKER_USER)" ]; then echo "Error: DOCKER_USER is required. Example: make docker/push DOCKER_USER=myusername"; exit 1; fi
	docker tag cove-server:latest $(DOCKER_USER)/cove-server:latest
	docker tag cove-webclient:latest $(DOCKER_USER)/cove-webclient:latest
	docker push $(DOCKER_USER)/cove-server:latest
	docker push $(DOCKER_USER)/cove-webclient:latest

## ── Combined ─────────────────────────────────────────────────────────────────
dev: ## Run backend + frontend concurrently (web mode)
	@$(MAKE) -j2 dev-back dev-front

clean: ## Remove build artifacts and temp data
	rm -f $(BIN)
	rm -rf backend/data/db/* backend/data/uploads/* client-web/dist/ client-desktop/build/bin/
