const socketIO = require("socket.io");
const express = require("express");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const config = require("./config");
const signallingServer = require("./signalling-server");

// Serve Static Files
app.use(express.static(path.join(__dirname, "www"), { maxAge: 0 }));

// Set View Engine
app.set("view engine", "ejs");

// Routes
app.get("/", (req, res) => res.render("index", { page: "index", title: "A free video chat for the web." }));

// Socket.IO Connection
io.sockets.on("connection", signallingServer);

// Export Express App for Vercel
module.exports = app;
