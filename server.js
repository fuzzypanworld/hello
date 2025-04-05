const express = require("express");
const path = require("path");
const { createServer } = require("http");
const { Server } = require("socket.io");
const signallingServer = require("./signalling-server");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Set up socket.io with the signalling server
io.on("connection", signallingServer);

// Set the views directory
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Serve Static Files
app.use(express.static(path.join(__dirname, "www"), { maxAge: 0 }));

// Home route
app.get("/", (req, res) => {
    res.render("index", { page: "index", title: "WEquil Meet - Simple, secure video conferencing" });
});

// Meeting route - handle any path as a meeting ID
app.get("/:meetingId", (req, res) => {
    res.render("index", { 
        page: "meeting", 
        title: "WEquil Meet - Meeting", 
        meetingId: req.params.meetingId 
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Export app for Vercel
module.exports = app;
