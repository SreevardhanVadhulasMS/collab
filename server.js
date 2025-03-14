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
dotenv.config();


const { Client } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

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
        const userExists = await db.query("SELECT * FROM users WHERE id = $1", [userId]);

        if (userExists.rows.length === 0) {
            await db.query("INSERT INTO users (id, name, email) VALUES ($1, $2, $3)", [userId, name, email]);
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
    console.log("Middleware Check - Authenticated?", req.isAuthenticated());
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect("/login");
};

const db = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

db.connect()
    .then(() => console.log(" Connected to PostgreSQL"))
    .catch((err) => console.error(" Database connection error:", err.stack));

app.get("/", (req, res) => {
    res.render("index");
});

app.get("/about", (req, res) => {
    res.render("about");
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        res.redirect("/home");
    }
);

app.get("/auth/discord", passport.authenticate("discord"));

app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", { failureRedirect: "/login" }),
    (req, res) => {
        res.redirect("/home");
    }
);

app.get("/auth/github", passport.authenticate("github"));

app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login" }),
    (req, res) => {
        res.redirect("/home");
    }
);

app.post("/submit", ensureAuthenticated, async (req, res) => {
    console.log("Form Data Received:", req.body);

    const { title, name, date, contact, timeline, description } = req.body;
    const user_id = req.user.id;  

    if (!title || !name || !date || !contact || !timeline || !description) {
        console.error("Missing form fields");
        return res.status(400).send("Missing required fields");
    }

    try {
        await db.query(
            "INSERT INTO posts (user_id, title, name, date, contact, timeline, description) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [user_id, title, name, date, contact, timeline, description]
        );
        console.log(" Post saved successfully");
        res.redirect("/home");
    } catch (err) {
        console.error("Error inserting post:", err);
        res.status(500).send("Error saving post");
    }
});

app.get("/fetch-posts", ensureAuthenticated, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM posts WHERE user_id = $1", [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching posts:", err);
        res.status(500).send("Error fetching posts");
    }
});


app.post("/delete-post", ensureAuthenticated, async (req, res) => {
    console.log("Delete Request Data:", req.body);

    if (!req.body.postId) {
        return res.status(400).send("Bad Request: Missing postId");
    }

    const { postId } = req.body;

    try {
        await db.query("DELETE FROM posts WHERE id = $1 AND user_id = $2", [postId, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting post:", err);
        res.status(500).send("Error deleting post");
    }
});
app.get("/fetch-all-posts", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT posts.title, posts.name, posts.date, posts.contact, posts.timeline, posts.description, users.name AS posted_by 
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




app.get("/home", ensureAuthenticated, (req, res) => {
    res.render("home", { user: req.user });
});

app.get("/create", ensureAuthenticated, (req, res) => {
    res.render("create", { user: req.user });
});

app.get("/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect("/");
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});
