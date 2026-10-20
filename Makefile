.PHONY: android/compile android/build android/install help build run dev dev-back dev-front front/dev front/install front/build front/test front/lint front/typecheck wails/dev wails/build wails/build/mac wails/build/windows wails/build/linux backend/release release swagger test tidy lint clean docker/build docker/push

release: clean backend/release wails/build/mac wails/build/windows wails/build/linux ## Build and package ALL assets for release
	./scripts/package_release.sh


GOBIN := $(HOME)/go/bin
GO    := go
PNPM  := pnpm
BIN   := nodetalk-server

help: ## Show this help
	@grep -E '^[a-zA-Z_/-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

## ── Backend ──────────────────────────────────────────────────────────────────
tidy: ## go mod tidy
	cd backend && $(GO) mod tidy

build: ## Build standalone web server binary
	cd backend && $(GO) build -o ../$(BIN) ./cmd/server

dev dev-back run: export GO_ENV := development
dev dev-back run: export NODE_ENV := development

dev-back: ## Run standalone backend in dev mode (go run)
	cd backend && $(GO) run ./cmd/server

run: dev-back ## Run standalone backend (alias for dev-back)

test: ## Run all tests with race detector
	cd backend && $(GO) test ./... -race -cover -count=1

lint: ## Run golangci-lint
	cd backend && golangci-lint run ./...

swagger: ## Regenerate Swagger docs (requires swag in GOBIN)
	cd backend && $(GOBIN)/swag init -g cmd/server/main.go --output docs --parseDependency

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
	cd client-desktop && $(GOBIN)/wails dev -s

wails/build: build front/build ## Build production Wails desktop binary
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	cd client-desktop && $(GOBIN)/wails build -clean -s

wails/build/mac: build front/build ## Build macOS universal binary
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	cd client-desktop && $(GOBIN)/wails build -clean -platform darwin/universal -s

wails/build/windows: build front/build ## Build Windows binary (amd64)
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	cd client-desktop && $(GOBIN)/wails build -clean -platform windows/amd64 -s

wails/build/linux: build front/build ## Build Linux binary (amd64)
	rm -rf client-desktop/frontend/dist
	mkdir -p client-desktop/frontend/dist
	cp -r client-web/dist/* client-desktop/frontend/dist/
	cd client-desktop && $(GOBIN)/wails build -clean -platform linux/amd64 -s

backend/release: ## Build backend binaries for multiple platforms
	mkdir -p release/backend
	GOOS=linux   GOARCH=amd64 $(GO) build -o release/backend/nodetalk-server-linux-amd64 backend/cmd/server/main.go
	GOOS=darwin  GOARCH=amd64 $(GO) build -o release/backend/nodetalk-server-darwin-amd64 backend/cmd/server/main.go
	GOOS=darwin  GOARCH=arm64 $(GO) build -o release/backend/nodetalk-server-darwin-arm64 backend/cmd/server/main.go
	GOOS=windows GOARCH=amd64 $(GO) build -o release/backend/nodetalk-server-windows-amd64.exe backend/cmd/server/main.go
	@echo "Backend binaries built in release/backend/"

## ── Docker ───────────────────────────────────────────────────────────────────
docker/setup: ## Create and switch to a multi-platform builder
	docker buildx create --name nodetalk-builder --use || docker buildx use nodetalk-builder
	docker buildx inspect --bootstrap

docker/build: ## Build production Docker images locally
	docker-compose build --pull

docker/build-multi: ## Build and push multi-platform Docker images (usage: make docker/build-multi DOCKER_USER=name)
	@if [ -z "$(DOCKER_USER)" ]; then echo "Error: DOCKER_USER is required."; exit 1; fi
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_USER)/nodetalk-server:latest --push ./backend
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_USER)/nodetalk-webclient:latest --push ./client-web

docker/push: docker/build ## Push images to Docker Hub (usage: make docker/push DOCKER_USER=name)
	@if [ -z "$(DOCKER_USER)" ]; then echo "Error: DOCKER_USER is required. Example: make docker/push DOCKER_USER=myusername"; exit 1; fi
	docker tag nodetalk-server:latest $(DOCKER_USER)/nodetalk-server:latest
	docker tag nodetalk-webclient:latest $(DOCKER_USER)/nodetalk-webclient:latest
	docker push $(DOCKER_USER)/nodetalk-server:latest
	docker push $(DOCKER_USER)/nodetalk-webclient:latest

## ── Combined ─────────────────────────────────────────────────────────────────
dev: ## Run backend + frontend concurrently (web mode)
	@$(MAKE) -j2 dev-back dev-front

clean: ## Remove build artifacts and temp data
	rm -f $(BIN)
	rm -rf backend/data/db/* backend/data/uploads/* client-web/dist/ client-desktop/build/bin/
