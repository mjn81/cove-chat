# Cove Desktop Build Guide

This document outlines the steps to build the Cove desktop application for **macOS**, **Windows**, and **Linux** using the Wails framework.

## 1. Prerequisites

Before building, ensure you have the following tools installed on your development machine:

- **Go**: v1.21+ 
- **Node.js & NPM**: v18+ (for building the React frontend)
- **Wails CLI**: v2.0+
- **Platform-Specific Dependencies**:
  - **macOS**: Xcode Command Line Tools.
  - **Windows**: WebView2 Runtime and a C compiler (e.g., Mingw-w64).
  - **Linux**: GTK3 and WebKit2GTK development headers (e.g., `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`).

---

## 2. Preparation (All Platforms)

The desktop app bundles the frontend as a static asset. You must build the frontend before running the Wails build.

### A. Install Dependencies
```bash
# In the root directory
make front/install
```

### B. Build the Frontend
```bash
# This generates the 'dist' folder in client-web/
make front/build
```

---

## 3. Platform-Specific Build Commands

### macOS (Universal Binary)
To build a universal binary that runs on both Intel and Apple Silicon:
```bash
# From the root directory
make wails/build/mac
```
**Output**: `client-desktop/build/bin/Cove.app`

### Windows (AMD64)
To build the Windows executable:
```bash
# From the root directory
cd client-desktop
~/go/bin/wails build -platform windows/amd64 -clean -s
```
**Output**: `client-desktop/build/bin/Cove.exe`

### Linux (AMD64)
To build for Linux:
```bash
# From the root directory
cd client-desktop
~/go/bin/wails build -platform linux/amd64 -clean -s
```
**Output**: `client-desktop/build/bin/cove-chat`

---

## 4. Using the Makefile (Recommended)

The included `Makefile` handles the asset syncing between `client-web` and `client-desktop` automatically.

| Command | Action |
| :--- | :--- |
| `make wails/build` | Builds for the **current** platform. |
| `make wails/build/mac` | Specifically builds the **Universal macOS** app. |
| `make clean` | Clears all build artifacts. |

> [!IMPORTANT]
> **Cross-Compilation Note**:
> - You **cannot** build macOS binaries from Windows or Linux.
> - Building for Windows/Linux from macOS is possible but requires complex cross-compiler setups (like `mingw-w64` or Docker). It is generally recommended to build on the target OS or via a CI/CD pipeline (e.g., GitHub Actions).

---

## 5. Deployment / Packaging

The output binaries in `client-desktop/build/bin/` are standalone. 
- For macOS, you can zip the `.app` or create a `.dmg`.
- For Windows, you can use the `.exe` directly or package it with an installer like **NSIS**.
- For Linux, you can distribute the binary or create a `.deb` / `.rpm` package.
