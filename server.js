const express = require("express");
const path = require("path");

const app = express();

// ✅ Explicitly set the views directory
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// ✅ Serve Static Files (Ensure "views" is included in the deployed files)
app.use(express.static(path.join(__dirname, "www"), { maxAge: 0 }));

// ✅ Test Route
app.get("/", (req, res) => {
    res.render("index", { page: "index", title: "A free video chat for the web." });
});

// ✅ Export app for Vercel
module.exports = app;
