#!/usr/bin/env node
/**
 * y-websocket-server.js — Y.js WebSocket sync server for DadaBot
 * 
 * Run: node y-websocket-server.js [port]
 * Default port: 1234
 * 
 * Supports:
 * - Multiple rooms (workspaces)
 * - Awareness (cursors, selections)
 * - Persistence to LevelDB/Redis (optional)
 * - Auth token validation (optional)
 */

import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { setupWSConnection } from "y-websocket/bin/utils";

const PORT = parseInt(process.argv[2]) || 1234;
const HOST = process.env.HOST || "0.0.0.0";

// In-memory document store (replace with LevelDB/Redis for production)
const docs = new Map();
// Auth token validation (implement your logic)
function validateToken(token) {
    if (!token) return true; // Allow anonymous for now
    // Add your validation logic here (JWT, API key, etc.)
    return true;
}

// Custom connection handler with auth
function handleConnection(ws, req, doc) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const room = url.searchParams.get("room") || "default";
    const token = url.searchParams.get("token");
    
    if (!validateToken(token)) {
        ws.close(4001, "Unauthorized");
        return;
    }
    
    console.log(`[${new Date().toISOString()}] Client connected to room: ${room}`);
    
    // Use y-websocket's built-in connection handler
    setupWSConnection(ws, req, doc);
    
    ws.on("close", () => {
        console.log(`[${new Date().toISOString()}] Client disconnected from room: ${room}`);
    });
    
    ws.on("error", (err) => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, err.message);
    });
}

// Create HTTP server for health checks
const http = require("http");
const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
            status: "ok", 
            rooms: docs.size,
            uptime: process.uptime()
        }));
        return;
    }
    if (req.url === "/rooms") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ rooms: Array.from(docs.keys()) }));
        return;
    }
    res.writeHead(404);
    res.end("Not found");
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const room = url.searchParams.get("room") || "default";
    
    // Get or create document for this room
    let doc = docs.get(room);
    if (!doc) {
        doc = new Y.Doc();
        docs.set(room, doc);
        console.log(`[${new Date().toISOString()}] Created new room: ${room}`);
    }
    
    handleConnection(ws, req, doc);
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 Y.js WebSocket server running on ws://${HOST}:${PORT}`);
    console.log(`   Health check: http://${HOST}:${PORT}/health`);
    console.log(`   Rooms list:   http://${HOST}:${PORT}/rooms`);
    console.log(`   Connect:      ws://${HOST}:${PORT}/?room=my-room&token=xxx`);
});

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down...");
    for (const [room, doc] of docs) {
        doc.destroy();
        console.log(`Closed room: ${room}`);
    }
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

process.on("SIGTERM", () => process.emit("SIGINT"));

export {};