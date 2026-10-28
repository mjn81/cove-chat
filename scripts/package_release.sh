#!/bin/bash
set -e

# package_release.sh
# Packages built Cove assets into zip files for GitHub release.

VERSION=${1:-"v0.1.0"}
RELEASE_DIR="release"
DIST_DIR="$RELEASE_DIR/dist"

echo "Creating release packages for $VERSION..."

# Ensure release directory exists
mkdir -p "$DIST_DIR"

# 1. Package Desktop Clients
echo "Packaging desktop clients..."

# macOS (Expects client-desktop/build/bin/Cove.app)
if [ -d "client-desktop/build/bin/Cove.app" ]; then
    cd client-desktop/build/bin
    zip -r "../../../$DIST_DIR/cove-desktop-mac-universal.zip" Cove.app
    cd ../../../
else
    echo "Warning: macOS build not found."
fi

# Windows (Expects client-desktop/build/bin/Cove.exe)
if [ -f "client-desktop/build/bin/Cove.exe" ]; then
    cp client-desktop/build/bin/Cove.exe "$DIST_DIR/cove-desktop-windows-amd64.exe"
    zip -j "$DIST_DIR/cove-desktop-windows-amd64.zip" "$DIST_DIR/cove-desktop-windows-amd64.exe"
    rm "$DIST_DIR/cove-desktop-windows-amd64.exe"
else
    echo "Warning: Windows build not found."
fi

# Linux (Expects client-desktop/build/bin/Cove)
if [ -f "client-desktop/build/bin/Cove" ]; then
    zip -j "$DIST_DIR/cove-desktop-linux-amd64.zip" client-desktop/build/bin/Cove
else
    echo "Warning: Linux build not found."
fi

# 2. Package Backend Server
echo "Packaging backend server binaries..."
if [ -d "$RELEASE_DIR/backend" ]; then
    cd "$RELEASE_DIR/backend"
    for f in *; do
        zip "../../$DIST_DIR/$f.zip" "$f"
    done
    cd ../../
else
    echo "Warning: Backend builds not found in $RELEASE_DIR/backend."
fi

# 3. Source Code (Optional, GitHub does this, but we can do a clean one)
# git archive --format=zip --output="$DIST_DIR/cove-source-code.zip" HEAD

echo "--------------------------------------------------"
echo "Release packages are ready in $DIST_DIR/"
ls -lh "$DIST_DIR"
