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
    .then(() => console.log("  Connected to Neon PostgreSQL"))
    .catch(err => console.error("  Database connection error:", err.stack));

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
        console.log("  Tables checked and created if not existing.");
    } catch (err) {
        console.error("  Error creating tables:", err);
    }
};

createTables();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("view engine", "ejs");
app.set("views", __dirname);

app.use("/css", express.static(path.join(__dirname, "css")));
app.use("/js", express.static(path.join(__dirname, "js")));
app.use("/images", express.static(path.join(__dirname, "images")));

const PgSession = connectPgSimple(session);
app.use(
    session({
        store: new PgSession({
            pool: client, 
            tableName: "session"
        }),
        secret: process.env.SESSION_SECRET || "default_secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 } 
    })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    console.log("  Serializing User:", user);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log("  Deserializing User:", user);
    done(null, user);
});

const ensureAuthenticated = (req, res, next) => {
    console.log(" Checking authentication:", req.isAuthenticated());
    if (req.isAuthenticated()) return next();
    res.redirect("/login");
};

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    await saveUserIfNotExists(profile.id, profile.displayName, profile.emails[0].value);
    return done(null, profile);
}));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL,
    scope: ["identify", "email"]
}, async (accessToken, refreshToken, profile, done) => {
    const email = profile.email || `${profile.id}@discord.com`;
    await saveUserIfNotExists(profile.id, profile.username, email);
    return done(null, profile);
}));

passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK_URL,
    scope: ["user:email"]
}, async (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || `${profile.id}@github.com`;
    await saveUserIfNotExists(profile.id, profile.displayName || profile.username, email);
    return done(null, profile);
}));

const saveUserIfNotExists = async (userId, name, email) => {
    try {
        const userExists = await client.query("SELECT * FROM users WHERE id = $1", [userId]);
        
        if (userExists.rows.length === 0) {
            console.log("🔹 New user detected, saving to DB:", name);
            
            await client.query("INSERT INTO users (id, name, email) VALUES ($1, $2, $3)", [userId, name, email]);
        } else {
            console.log("Existing user logged in:", name);
        }
    } catch (err) {
        console.error(" Error saving user:", err);
    }
};


app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback", 
    passport.authenticate("google", { failureRedirect: "/login" }), 
    (req, res) => {
        console.log(" Google Authentication Successful:", req.user);
        res.redirect("/home");  
    }
);
app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback", 
    passport.authenticate("discord", { failureRedirect: "/login" }), 
    (req, res) => {
        console.log(" Discord Authentication Successful:", req.user);
        res.redirect("/home");
    }
);
app.get("/auth/github", passport.authenticate("github"));
app.get("/auth/github/callback", 
    passport.authenticate("github", { failureRedirect: "/login" }), 
    (req, res) => {
        console.log(" GitHub Authentication Successful:", req.user);
        res.redirect("/home");
    }
);






app.get("/logout", (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        req.session.destroy(() => res.redirect("/"));
    });
});

app.get("/", (req, res) => res.render("index"));
app.get("/about", (req, res) => res.render("about"));
app.get("/login", (req, res) => res.render("login"));
app.get("/create", ensureAuthenticated, (req, res) => res.render("create", { user: req.user }));
app.get("/home", ensureAuthenticated, (req, res) => {
    console.log("🔍 Checking user session:", req.user);
    if (!req.user) {
        console.log(" No user session found! Redirecting to login.");
        return res.redirect("/login");
    }
    res.render("home", { user: req.user });
});


app.get("/fetch-posts", ensureAuthenticated, async (req, res) => {
    try {
        const result = await client.query("SELECT * FROM posts WHERE user_id = $1", [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error("  Error fetching posts:", err);
        res.status(500).send("Error fetching posts");
    }
});

app.get("/fetch-all-posts", async (req, res) => {
    try {
        const result = await client.query("SELECT posts.*, users.name AS posted_by FROM posts INNER JOIN users ON posts.user_id = users.id ORDER BY posts.created_at DESC");
        res.json(result.rows);
    } catch (err) {
        console.error("  Error fetching all posts:", err);
        res.status(500).send("Error fetching posts");
    }
});

app.listen(PORT, () => console.log(` Server running on port: ${PORT}`));
