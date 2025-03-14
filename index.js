import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import bcrypt from "bcrypt";
import pkg from "pg";
import dotenv from "dotenv";
import connectPgSimple from "connect-pg-simple";

dotenv.config();
const { Client } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

client.connect()
    .then(() => console.log("Connected to Neon PostgreSQL"))
    .catch(err => console.error("Database connection error:", err.stack));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("view engine", "ejs");

app.set("views", path.resolve());

app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/images", express.static(path.join(__dirname, "images")));

const PgSession = connectPgSimple(session);
app.use(
    session({
        store: new PgSession({
            conString: process.env.DATABASE_URL,
        }),
        secret: process.env.SESSION_SECRET || "default_secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,  
            httpOnly: true,
            sameSite: "strict",
            maxAge: 1000 * 60 * 60 * 24, 
        },
    })
);

app.use((req, res, next) => {
    console.log("Current session:", req.session);
    next();
});

const ensureAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect("/login");
};

app.get("/", (req, res) => res.render("index"));
app.get("/about", (req, res) => res.render("about"));
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));
app.get("/home", ensureAuthenticated, (req, res) => res.render("home", { user: req.session.user }));
app.get("/create", ensureAuthenticated, (req, res) => res.render("create", { user: req.session.user }));

app.post("/register", async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).send("All fields are required.");
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query("INSERT INTO users (name, email, password) VALUES ($1, $2, $3)", [name, email, hashedPassword]);
        res.redirect("/login");
    } catch (err) {
        console.error("Error registering user:", err);
        res.status(500).send("Error registering user.");
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    console.log("Login attempt:", email);

    try {
        const result = await client.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            console.log("No user found");
            return res.status(401).json({ success: false, message: "Invalid credentials." });
        }

        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            console.log("Password mismatch");
            return res.status(401).json({ success: false, message: "Invalid credentials." });
        }

        req.session.user = { id: user.id, name: user.name, email: user.email };
        req.session.save(err => {
            if (err) {
                console.error("Session save error:", err);
                return res.status(500).json({ success: false, message: "Session error." });
            }
            console.log("User logged in:", req.session.user);
            res.json({ success: true, redirectUrl: "/home" });
        });

    } catch (err) {
        console.error("Error logging in:", err);
        res.status(500).json({ success: false, message: "Error logging in." });
    }
});

app.get("/fetch-posts", ensureAuthenticated, async (req, res) => {
    try {
        console.log("Fetching posts for user:", req.session.user.id);
        const result = await client.query(
            "SELECT id, title, date, name, contact, timeline, description FROM posts WHERE user_id = $1 ORDER BY id DESC",
            [req.session.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching posts:", err);
        res.status(500).send("Error fetching posts.");
    }
});

app.post("/create-post", ensureAuthenticated, async (req, res) => {
    const { title, name, date, contact, timeline, description } = req.body;

    if (!title || !name || !date || !contact || !timeline || !description) {
        return res.status(400).send("All fields are required.");
    }

    try {
        await client.query(
            "INSERT INTO posts (user_id, title, name, date, contact, timeline, description) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [req.session.user.id, title, name, date, contact, timeline, description]
        );
        res.redirect("/home");
    } catch (err) {
        console.error("Error creating post:", err);
        res.status(500).send("Error creating post.");
    }
});

app.post("/delete-post", ensureAuthenticated, async (req, res) => {
    const { postId } = req.body;
    if (!postId) return res.status(400).send("Post ID is required.");

    try {
        await client.query("DELETE FROM posts WHERE id = $1 AND user_id = $2", [postId, req.session.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting post:", err);
        res.status(500).send("Error deleting post.");
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
});

app.get("/session-check", (req, res) => {
    console.log("Checking session:", req.session);
    res.json(req.session);
});

app.listen(PORT, () => console.log(`Server running on port: ${PORT}`));
