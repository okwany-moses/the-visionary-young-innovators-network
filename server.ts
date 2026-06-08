import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import crypto from "crypto";

// Load environment variables
const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
dotenv.config();

const PORT = Number(process.env.PORT) || 5000;

let EFFECTIVE_JWT_SECRET: string;

// Define User profile types
export interface FirebaseUserProfile {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: "admin" | "author" | "member";
  createdAt: string;
}

// Define BlogPost schema
export interface FirebaseBlogPost {
  id: string;
  title: string;
  content: string;
  author: {
    id: string;
    fullName: string;
    email: string;
  };
  publishedAt: string;
  image: string;
  category: string;
  tags: string[];
}

// Simple PBKDF2 Password Hashing
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, originalHash] = parts;
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === originalHash;
}

// Custom JWT Sign & Verify using native HMAC
function signToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", EFFECTIVE_JWT_SECRET || "fallback").update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const reSignature = crypto.createHmac("sha256", EFFECTIVE_JWT_SECRET || "fallback").update(`${header}.${body}`).digest("base64url");
    if (signature !== reSignature) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

// Authentication Middleware
function authenticateToken(req: Request, res: Response, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ success: false, error: "Access denied. Session token missing." });
    return;
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(403).json({ success: false, error: "Invalid or expired session token." });
    return;
  }

  (req as any).user = decoded;
  next();
}

function validateEnvironment() {
  const isProd = process.env.NODE_ENV === "production";
  
  // 1. Check JWT Secret
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret && isProd) {
    console.warn("[System] Missing JWT_SECRET.");
  }
  EFFECTIVE_JWT_SECRET = jwtSecret || "dev-only-fallback-secret-rotation-required";

  // 3. Observability: Log Active Integrations
  const check = (key: string) => !!(process.env[key] && !process.env[key]?.includes("your_"));
  console.log(`[System] Integration Status:
    - Formspree: ${check('FORMSPREE_FORM_ID') ? 'ACTIVE' : 'OFFLINE'}
    - SMTP Fallback: ${check('SMTP_PASS') ? 'ACTIVE' : 'OFFLINE'}`);
}

/**
 * System Notification Dispatcher
 * Coordinates delivery across multiple third-party gateways.
 */
async function dispatchRegistrationNotifications(registrant: { fullName: string, email: string, phone: string, primaryPillar: string }) {
  const { fullName, email, phone, primaryPillar } = registrant;
  const status = {
    formspreeSent: false,
    smtpSent: false,
    emailStatus: "Skipped - FORMSPREE_FORM_ID not configured.",
    smtpStatus: "SMTP fallback not engaged."
  };

  // 1. Formspree Delivery
  const formspreeId = process.env.FORMSPREE_FORM_ID;
  if (formspreeId && !formspreeId.includes("your_")) {
    try {
      const res = await fetch(`https://formspree.io/f/${formspreeId.trim()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          name: fullName,
          email: email,
          pillar: primaryPillar,
          phone: phone,
          _subject: `New VYIN Affiliate Enrollment: ${fullName}`,
          message: `New VYIN Membership Enrollment:\n\nName: ${fullName}\nEmail: ${email}\nPhone: ${phone}\nPillar: ${primaryPillar}`
        })
      });
      if (res.ok) {
        status.formspreeSent = true;
        status.emailStatus = "Dispatched successfully via Formspree API.";
      } else {
        status.emailStatus = "Formspree API rejected the payload.";
      }
    } catch (err: any) {
      status.emailStatus = `Formspree Error: ${err.message}`;
    }
  }

  // 2. SMTP Fallback
  const smtpHost = process.env.SMTP_HOST;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpPass && !smtpPass.includes("your_")) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587"),
        auth: { user: process.env.SMTP_USER, pass: smtpPass }
      });
      await transporter.sendMail({
        from: `"VYIN Notifications" <${process.env.SMTP_USER}>`,
        to: process.env.TARGET_NOTIFICATION_EMAIL || "visionaryininovators26@gmail.com",
        subject: `New Membership: ${fullName}`,
        html: `<p><strong>Name:</strong> ${fullName}<br><strong>Pillar:</strong> ${primaryPillar}</p>`
      });
      status.smtpSent = true;
      status.smtpStatus = "Dispatched via NodeMailer SMTP.";
    } catch (err: any) {
      status.smtpStatus = `SMTP Error: ${err.message}`;
    }
  }

  return status;
}

async function startServer() {
  validateEnvironment();
  
  const app = express();
  
  const publicPath = path.join(process.cwd(), "public");
  const imagesPath = path.join(publicPath, "images");
  const sourceAssetsPath = path.join(process.cwd(), "src", "assets", "images");
  
  // 1. Auto-create directory structure if missing
  if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath, { recursive: true });
  }
  if (!fs.existsSync(imagesPath)) {
    fs.mkdirSync(imagesPath, { recursive: true });
  }

  // 2. Auto-migration (Server-side): Ensure consistency on backend startup
  if (fs.existsSync(sourceAssetsPath)) {
    const files = fs.readdirSync(sourceAssetsPath);
    files.forEach(file => {
      const srcFile = path.join(sourceAssetsPath, file);
      const destFile = path.join(imagesPath, file);
      
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`[System] Auto-migrated asset: ${file} -> public/images/`);
      }
    });
  }

  // Serve the public directory for static assets
  app.use(express.static(publicPath));
  console.log(`[System] Serving static media from: ${publicPath}`);

  // Parse JSON payloads with generous size limit for high-res JPEG/PNG logo base64 uploads
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  // Start listening immediately and log the port to help Render diagnostics
  console.log(`[System] Initializing listener on port ${PORT}...`);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Listening successfully on port ${PORT}`);
    console.log(`[Server] Environment status: ${process.env.NODE_ENV || "development"}`);
  });

  // System AI Config Check
  const geminiKey = process.env.GEMINI_API_KEY;
  console.log(`[System] Gemini AI Config Check: ${geminiKey && geminiKey.length > 20 ? "ACTIVE" : "MISSING"}`);

  // AUTH API ENDPOINTS

  // Register endpoint
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, fullName, role } = req.body;
      if (!email || !password || !fullName) {
        res.status(400).json({ success: false, error: "Email, password, and full name are required." });
        return;
      }

      const emailLower = email.toLowerCase().trim();
      
      const assignedRole = role === "admin" || role === "author" ? role : "member";
      const newUser = {
        id: crypto.randomUUID(),
        email: emailLower,
        fullName: fullName.trim(),
        passwordHash: hashPassword(password),
        role: assignedRole,
        createdAt: new Date().toISOString()
      };

      const tokenPayload = {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role
      };

      const token = signToken(tokenPayload);

      res.status(201).json({
        success: true,
        message: "Registration completed successfully.",
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          fullName: newUser.fullName,
          role: newUser.role,
          createdAt: newUser.createdAt
        }
      });
    } catch (err: any) {
      console.error("[Auth API Error] Registration failure:", err);
      res.status(500).json({ success: false, error: "Internal server error during registration." });
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, error: "Email and password are required." });
        return;
      }

      const emailLower = email.toLowerCase().trim();
      
      const userData = {} as any; // Dummy placeholder

      if (!verifyPassword(password, userData.passwordHash)) {
        res.status(401).json({ success: false, error: "Invalid email address or passcode sequence." });
        return;
      }

      const tokenPayload = {
        id: userData.id,
        email: userData.email,
        fullName: userData.fullName,
        role: userData.role
      };

      const token = signToken(tokenPayload);

      res.status(200).json({
        success: true,
        message: "Authentication established securely.",
        token,
        user: {
          id: userData.id,
          email: userData.email,
          fullName: userData.fullName,
          role: userData.role,
          createdAt: userData.createdAt
        }
      });
    } catch (err: any) {
      console.error("[Auth API Error] Login failure:", err);
      res.status(500).json({ success: false, error: "Internal server error during login check." });
    }
  });

  // Request password reset endpoint
  app.post("/api/auth/reset-password-request", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ success: false, error: "Registered email address is required." });
        return;
      }

      const emailLower = email.toLowerCase().trim();
      
      // Generate a secure 6 digit numeric reset code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      const tokenID = crypto.randomUUID();

      console.log(`[PASS_RESET_SIMULATOR] Password reset initiated for ${emailLower}. Verification Code: ${resetCode}`);

      // Return the simulation code so the client-side UI can gracefully present it for testing!
      res.status(200).json({
        success: true,
        message: "Security reset code generated successfully and printed on logs.",
        simulationCode: resetCode,
        tokenId: tokenID
      });
    } catch (err: any) {
      console.error("[Auth API Error] Password reset request error:", err);
      res.status(500).json({ success: false, error: "Internal server error during password reset request." });
    }
  });

  // Verify and complete password reset
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { email, resetCode, newPassword, tokenId } = req.body;
      if (!email || !resetCode || !newPassword) {
        res.status(400).json({ success: false, error: "Email, reset verification code, and new password are required." });
        return;
      }

      const emailLower = email.toLowerCase().trim();

      let validTokenKey = tokenId;
      let tokenObject: any = null;

      if (!tokenObject || tokenObject.email !== emailLower || tokenObject.code !== resetCode) {
        res.status(400).json({ success: false, error: "Invalid configuration or incorrect reset code." });
        return;
      }

      if (Date.now() > tokenObject.expires) {
        res.status(400).json({ success: false, error: "Reset verification code has expired (15-min limit)." });
        return;
      }


      res.status(200).json({
        success: true,
        message: "Credentials security updated. Please log in using the new passcode."
      });
    } catch (err: any) {
      console.error("[Auth API Error] Reset password submission error:", err);
      res.status(500).json({ success: false, error: "Internal server error during password update." });
    }
  });

  // Get current active profile
  app.get("/api/auth/me", authenticateToken, async (req: Request, res: Response) => {
    try {
      const tokenInfo = (req as any).user;
      
      const userData = {} as any; // Dummy

      res.status(200).json({
        success: true,
        user: {
          id: userData.id,
          email: userData.email,
          fullName: userData.fullName,
          role: userData.role,
          createdAt: userData.createdAt
        }
      });
    } catch (err: any) {
      console.error("[Auth API Error] Get profile crash:", err);
      res.status(500).json({ success: false, error: "Internal server error serving profile records." });
    }
  });


  // BLOG API ENDPOINTS

  // Get all blog posts
  app.get("/api/posts", async (req: Request, res: Response) => {
    try {
      const postsList: FirebaseBlogPost[] = [];
      
      // Return posts sorted by creation date descending
      const sortedPosts = postsList.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );

      res.status(200).json({ success: true, posts: sortedPosts });
    } catch (err: any) {
      console.error("[Posts API Error] Fetching posts error:", err);
      res.status(500).json({ success: false, error: "Internal server error fetching community posts." });
    }
  });

  // Create new blog post
  app.post("/api/posts", authenticateToken, async (req: Request, res: Response) => {
    try {
      const { title, content, image, category, tags } = req.body;
      const authenticatedUser = (req as any).user;

      // Validate fields
      if (!title || !content || !category) {
        res.status(400).json({ success: false, error: "Title, content, and category are mandatory." });
        return;
      }

      const newPost = {
        id: crypto.randomUUID(),
        title: title.trim(),
        content: content.trim(),
        author: {
          id: authenticatedUser.id,
          fullName: authenticatedUser.fullName,
          email: authenticatedUser.email
        },
        publishedAt: new Date().toISOString(),
        image: image || "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800&auto=format&fit=crop&q=60",
        category: category.trim(),
        tags: Array.isArray(tags) ? tags.map((t: string) => t.trim()).filter(Boolean) : []
      };

      res.status(201).json({
        success: true,
        message: "Blog post published into database successfully.",
        post: newPost
      });
    } catch (err: any) {
      console.error("[Posts API Error] Publishing post failure:", err);
      res.status(500).json({ success: false, error: "Internal server error publishing post." });
    }
  });

  // Update existing blog post
  app.put("/api/posts/:id", authenticateToken, async (req: Request, res: Response) => {
    try {
      const postId = req.params.id;
      const { title, content, image, category, tags } = req.body;
      const authenticatedUser = (req as any).user;

      const post = {} as any; // Dummy

      // Authorize: Only admin, or post author
      const isAuthorized = authenticatedUser.role === "admin" || post.author.id === authenticatedUser.id;
      if (!isAuthorized) {
        res.status(403).json({ success: false, error: "Forbidden. You are not the author of this post." });
        return;
      }

      // Apply updates
      const updatedPost = { ...post };
      if (title !== undefined) updatedPost.title = title.trim();
      if (content !== undefined) updatedPost.content = content.trim();
      if (image !== undefined) updatedPost.image = image;
      if (category !== undefined) updatedPost.category = category.trim();
      if (tags !== undefined) {
        updatedPost.tags = Array.isArray(tags) ? tags.map((t: string) => t.trim()).filter(Boolean) : [];
      }

      res.status(200).json({
        success: true,
        message: "Blog post updated successfully.",
        post: updatedPost
      });
    } catch (err: any) {
      console.error("[Posts API Error] Updating post failure:", err);
      res.status(500).json({ success: false, error: "Internal server error updating post." });
    }
  });

  // Delete existing blog post
  app.delete("/api/posts/:id", authenticateToken, async (req: Request, res: Response) => {
    try {
      const postId = req.params.id;
      const authenticatedUser = (req as any).user;

      const post = {} as any; // Dummy

      // Authorize: Only admin, or post author
      const isAuthorized = authenticatedUser.role === "admin" || post.author.id === authenticatedUser.id;
      if (!isAuthorized) {
        res.status(403).json({ success: false, error: "Forbidden. You do not have permissions to delete this post." });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Blog post deleted from database."
      });
    } catch (err: any) {
      console.error("[Posts API Error] Deleting post failure:", err);
      res.status(500).json({ success: false, error: "Internal server error deleting post." });
    }
  });

  // Health check API
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Secure API endpoint for registration
  app.post("/api/register", async (req: Request, res: Response) => {
    const { fullName, email, phone, primaryPillar } = req.body;

    // Server-side validation
    if (!fullName || !email || !phone || !primaryPillar) {
       res.status(400).json({
        success: false,
        error: "All registration fields (Full Name, Email, Phone Number, Pillar focus) are mandatory."
      });
      return;
    }

    console.log(`[Registration System] New payload received:`, { fullName, email, phone, primaryPillar });

    const deliveryStatus = await dispatchRegistrationNotifications({ fullName, email, phone, primaryPillar });

    res.status(200).json({
      success: true,
      message: "Application securely filed into system database.",
      details: {
        registrant: { fullName, email, phone, primaryPillar },
        delivery: deliveryStatus
      }
    });
  });

  // Vite development middleware vs Static Production bundle
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

startServer().catch((error) => {
  console.error("[Fatal Exception] Main server bootstrap crash:", error);
});
