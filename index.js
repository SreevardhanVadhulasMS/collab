import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import passport from "passport";
import session from "express-session";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as DiscordStrategy } from "passport-discord";
import { Strategy as GitHubStrategy } from "passport-github";
import pkg from "pg";
import dotenv from "dotenv";
import pgSession from "connect-pg-simple";

app.use(
    session({
        store: new pgSession({
            pool: client, 
            tableName: "session"
        }),
        secret: process.env.SESSION_SECRET || "default_secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: true, maxAge: 1000 * 60 * 60 * 24 } 
    })
);
dotenv.config();

const { Client } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;
app.use(
    session({
        secret: process.env.SESSION_SECRET || "default_secret", 
        resave: false,
        saveUninitialized: false
    })
);



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", __dirname);

app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/images", express.static(path.join(__dirname, "images")));

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
    })
);

app.use(passport.initialize());
app.use(passport.session());

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, 
    },
});

client.connect()
    .then(() => console.log(" Connected to Neon PostgreSQL"))
    .catch(err => console.error(" Database connection error:", err.stack));

const createTables = async () => {
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL
            );

            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                name TEXT NOT NULL,
                date DATE NOT NULL,
                contact TEXT NOT NULL,
                timeline TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log(" Tables checked and created if not existing.");
    } catch (err) {
        console.error(" Error creating tables:", err);
    }
};

createTables();

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            const userId = profile.id;
            const name = profile.displayName;
            const email = profile.emails[0].value;
            await saveUserIfNotExists(userId, name, email);
            return done(null, profile);
        }
    )
);

passport.use(
    new DiscordStrategy(
        {
            clientID: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            callbackURL: process.env.DISCORD_CALLBACK_URL,
            scope: ["identify", "email"],
        },
        async (accessToken, refreshToken, profile, done) => {
            const userId = profile.id;
            const name = profile.username;
            const email = profile.email || `${userId}@discord.com`;
            await saveUserIfNotExists(userId, name, email);
            return done(null, profile);
        }
    )
);

passport.use(
    new GitHubStrategy(
        {
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.GITHUB_CALLBACK_URL,
            scope: ["user:email"],
        },
        async (accessToken, refreshToken, profile, done) => {
            const userId = profile.id;
            const name = profile.displayName || profile.username;
            const email = profile.emails?.[0]?.value || `${userId}@github.com`;
            await saveUserIfNotExists(userId, name, email);
            return done(null, profile);
        }
    )
);

const saveUserIfNotExists = async (userId, name, email) => {
    try {
        const userExists = await client.query("SELECT * FROM users WHERE id = $1", [userId]);

        if (userExists.rows.length === 0) {
            await client.query("INSERT INTO users (id, name, email) VALUES ($1, $2, $3)", [userId, name, email]);
            console.log(" New user added:", name);
        }
    } catch (err) {
        console.error(" Error saving user:", err);
    }
};

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect("/login");
};

app.get("/create", ensureAuthenticated, (req, res) => {
    res.render("create", { user: req.user });
});


app.get("/", (req, res) => res.render("index"));
app.get("/about", (req, res) => res.render("about"));
app.get("/login", (req, res) => res.render("login"));

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), (req, res) => {
    res.redirect("/home");
});

app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback", passport.authenticate("discord", { failureRedirect: "/login" }), (req, res) => {
    res.redirect("/home");
});

app.get("/auth/github", passport.authenticate("github"));
app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/login" }), (req, res) => {
    res.redirect("/home");
});
app.get("/logout", (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            res.redirect("/");  
        });
    });
});


app.get("/fetch-posts", ensureAuthenticated, async (req, res) => {
    try {
        console.log(" Fetching user posts...");
        const result = await client.query("SELECT * FROM posts WHERE user_id = $1", [req.user.id]);

        if (result.rows.length === 0) {
            console.log("No posts found for user:", req.user.id);
        } else {
            console.log("Posts fetched:", result.rows);
        }

        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching posts:", err);
        res.status(500).send("Error fetching posts");
    }
});

app.get("/fetch-all-posts", async (req, res) => {
    try {
        const result = await client.query(`
            SELECT posts.*, users.name AS posted_by 
            FROM posts 
            INNER JOIN users ON posts.user_id = users.id 
            ORDER BY posts.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(" Error fetching posts:", err);
        res.status(500).send("Error fetching posts");
    }
});
app.post("/submit", ensureAuthenticated, async (req, res) => {
    const { title, name, date, contact, timeline, description } = req.body;
    const user_id = req.user.id;

    if (!title || !name || !date || !contact || !timeline || !description) {
        return res.status(400).send("Missing required fields");
    }

    try {
        await client.query(
            "INSERT INTO posts (user_id, title, name, date, contact, timeline, description) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [user_id, title, name, date, contact, timeline, description]
        );
        console.log(" Post submitted successfully");
        res.redirect("/home");
    } catch (err) {
        console.error("Error inserting post:", err);
        res.status(500).send("Error saving post");
    }
});

app.post("/delete-post", ensureAuthenticated, async (req, res) => {
    const { postId } = req.body;  

    if (!postId) {
        return res.status(400).json({ success: false, message: "Missing post ID" });
    }

    try {
        const result = await client.query(
            "DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING *",
            [postId, req.user.id]  
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Post not found or unauthorized" });
        }

        res.json({ success: true, message: "Post deleted successfully" });
    } catch (err) {
        console.error("Error deleting post:", err);
        res.status(500).json({ success: false, message: "Error deleting post" });
    }
});


app.get("/home", ensureAuthenticated, (req, res) => res.render("home", { user: req.user }));

app.listen(PORT, () => console.log(` Server running on port: ${PORT}`));
