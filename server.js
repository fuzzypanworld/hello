const express = require("express");
const path = require("path");

const app = express();

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

// Export app for Vercel
module.exports = app;
