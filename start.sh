#!/bin/bash

echo "🦊 Starting Camofox Browser Engine in the background..."
# Start camofox in the background (&)
npm start &

echo "⏳ Waiting 15 seconds for Camofox to initialize and download binaries..."
sleep 15

echo "🚀 Starting Dashboard Server..."
# Start your dashboard server
node dashboard-server.js