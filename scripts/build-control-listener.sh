#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT_DIR/native/control_listener.swift"
OUTPUT_DIR="$ROOT_DIR/build/bin"
OUTPUT="$OUTPUT_DIR/control-listener"

mkdir -p "$OUTPUT_DIR"
swiftc "$SOURCE" -O -framework Cocoa -framework ApplicationServices -o "$OUTPUT"
