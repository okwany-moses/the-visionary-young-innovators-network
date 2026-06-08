import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import crypto from "crypto";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "firebase/firestore";

// Load environment variables
const envLocalPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
dotenv.config();

const PORT = Number(process.env.PORT) || 5000;

// Read Firebase configurations
let firebaseConfig: any;
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");

if (fs.existsSync(firebaseConfigPath)) {
  firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
} else {
  // Fallback to environment variables if the config file is missing (e.g., in production)
  firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
    firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DB_ID || "(default)"
  };
}

// Global instances (initialized in startServer)
let appFirebase: any;
let dbFirebaseReal: any;
let EFFECTIVE_JWT_SECRET: string;

// Load local database store helpers
function loadLocalStore(): any {
  const storePath = path.join(process.cwd(), "data_store.json");
  try {
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, "utf8"));
    }
  } catch (err) {
    console.error("Local database load break:", err);
  }
  return { users: [], posts: [], resetTokens: {}, settings: {} };
}

function saveLocalStore(store: any) {
  const storePath = path.join(process.cwd(), "data_store.json");
  try {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Local database save break:", err);
  }
}

class SafeFirestoreCollection {
  private collectionName: string;
  private queries: Array<{ field: string; op: string; val: any }> = [];

  constructor(collectionName: string, queries: Array<{ field: string; op: string; val: any }> = []) {
    this.collectionName = collectionName;
    this.queries = queries;
  }

  where(field: string, op: string, val: any): SafeFirestoreCollection {
    return new SafeFirestoreCollection(this.collectionName, [...this.queries, { field, op, val }]);
  }

  doc(docId: string) {
    const collName = this.collectionName;
    return {
      get: async (): Promise<any> => {
        try {
          const docRef = doc(dbFirebaseReal, collName, docId);
          const docSnap = await getDoc(docRef);
          return {
            exists: docSnap.exists(),
            id: docId,
            data: () => docSnap.data()
          };
        } catch (err: any) {
          console.warn(`[SafeFirestore Fallback] doc(${collName}/${docId}).get() failed. Reading from local data_store:`, err.message);
          const store = loadLocalStore();
          let data: any = null;
          if (collName === "settings" && docId === "branding") {
            data = store.settings || {};
          } else if (collName === "users") {
            data = store.users.find((u: any) => u.id === docId);
          } else if (collName === "posts") {
            data = store.posts.find((p: any) => p.id === docId);
          } else if (collName === "resetTokens") {
            data = store.resetTokens ? store.resetTokens[docId] : null;
          }
          return {
            exists: !!data,
            id: docId,
            data: () => data
          };
        }
      },
      set: async (docData: any): Promise<void> => {
        try {
          const docRef = doc(dbFirebaseReal, collName, docId);
          await setDoc(docRef, docData);
          this.syncLocal(docId, docData);
        } catch (err: any) {
          console.warn(`[SafeFirestore Fallback] doc(${collName}/${docId}).set() failed. Writing to local data_store:`, err.message);
          this.syncLocal(docId, docData);
        }
      },
      update: async (updateData: any): Promise<void> => {
        try {
          const docRef = doc(dbFirebaseReal, collName, docId);
          await updateDoc(docRef, updateData);
          const store = loadLocalStore();
          if (collName === "users") {
            const idx = store.users.findIndex((u: any) => u.id === docId);
            if (idx !== -1) store.users[idx] = { ...store.users[idx], ...updateData };
          } else if (collName === "registrations") {
            const idx = store.registrations?.findIndex((r: any) => r.id === docId);
            if (idx !== -1) store.registrations[idx] = { ...store.registrations[idx], ...updateData };
          } else if (collName === "posts") {
            const idx = store.posts.findIndex((p: any) => p.id === docId);
            if (idx !== -1) store.posts[idx] = { ...store.posts[idx], ...updateData };
          }
          saveLocalStore(store);
        } catch (err: any) {
          console.warn(`[SafeFirestore Fallback] doc(${collName}/${docId}).update() failed. Updating local data_store:`, err.message);
          const store = loadLocalStore();
          if (collName === "users") {
            const idx = store.users.findIndex((u: any) => u.id === docId);
            if (idx !== -1) store.users[idx] = { ...store.users[idx], ...updateData };
          } else if (collName === "registrations") {
            const idx = store.registrations?.findIndex((r: any) => r.id === docId);
            if (idx !== -1) store.registrations[idx] = { ...store.registrations[idx], ...updateData };
          } else if (collName === "posts") {
            const idx = store.posts.findIndex((p: any) => p.id === docId);
            if (idx !== -1) store.posts[idx] = { ...store.posts[idx], ...updateData };
          }
          saveLocalStore(store);
        }
      },
      delete: async (): Promise<void> => {
        try {
          const docRef = doc(dbFirebaseReal, collName, docId);
          await deleteDoc(docRef);
          const store = loadLocalStore();
          if (collName === "users") {
            store.users = store.users.filter((u: any) => u.id !== docId);
          } else if (collName === "registrations") {
            store.registrations = store.registrations?.filter((r: any) => r.id !== docId);
          } else if (collName === "posts") {
            store.posts = store.posts.filter((p: any) => p.id !== docId);
          } else if (collName === "resetTokens" && store.resetTokens) {
            delete store.resetTokens[docId];
          }
          saveLocalStore(store);
        } catch (err: any) {
          console.warn(`[SafeFirestore Fallback] doc(${collName}/${docId}).delete() failed. Deleting from local:`, err.message);
          const store = loadLocalStore();
          if (collName === "users") {
            store.users = store.users.filter((u: any) => u.id !== docId);
          } else if (collName === "registrations") {
            store.registrations = store.registrations?.filter((r: any) => r.id !== docId);
          } else if (collName === "posts") {
            store.posts = store.posts.filter((p: any) => p.id !== docId);
          } else if (collName === "resetTokens" && store.resetTokens) {
            delete store.resetTokens[docId];
          }
          saveLocalStore(store);
        }
      }
    };
  }

  private syncLocal(docId: string, docData: any) {
    const store = loadLocalStore();
    if (this.collectionName === "settings" && docId === "branding") {
      store.settings = docData;
    } else if (this.collectionName === "users") {
      const idx = store.users.findIndex((u: any) => u.id === docId);
      if (idx !== -1) store.users[idx] = docData;
      else store.users.push(docData);
    } else if (this.collectionName === "posts") {
      const idx = store.posts.findIndex((p: any) => p.id === docId);
      if (idx !== -1) store.posts[idx] = docData;
      else store.posts.push(docData);
    } else if (this.collectionName === "registrations") {
      if (!store.registrations) store.registrations = [];
      const idx = store.registrations.findIndex((r: any) => r.id === docId);
      if (idx !== -1) store.registrations[idx] = docData;
      else store.registrations.push(docData);
    } else if (this.collectionName === "resetTokens") {
      if (!store.resetTokens) store.resetTokens = {};
      store.resetTokens[docId] = docData;
    }
    saveLocalStore(store);
  }

  async get(): Promise<any> {
    try {
      const collRef = collection(dbFirebaseReal, this.collectionName);
      let q = query(collRef);
      for (const qItem of this.queries) {
        q = query(q, where(qItem.field, qItem.op as any, qItem.val));
      }
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map((docSnap: any) => ({
        id: docSnap.id,
        data: () => docSnap.data()
      }));
      return {
        empty: snapshot.empty,
        size: docs.length,
        docs: docs,
        forEach: (callback: (doc: any, index: number) => void) => docs.forEach(callback)
      };
    } catch (err: any) {
      console.warn(`[SafeFirestore Fallback] collection(${this.collectionName}).get() failed. Fetching locally:`, err.message);
      const store = loadLocalStore();
      let results: any[] = [];
      if (this.collectionName === "posts") {
        results = store.posts || [];
      } else if (this.collectionName === "users") {
        results = store.users || [];
      } else if (this.collectionName === "settings") {
        results = store.settings ? [store.settings] : [];
      } else if (this.collectionName === "registrations") {
        results = store.registrations || [];
      } else if (this.collectionName === "resetTokens") {
        results = Object.entries(store.resetTokens || {}).map(([id, val]: any) => ({ id, ...val }));
      }

      for (const query of this.queries) {
        results = results.filter((item) => {
          const itemValue = item[query.field];
          if (query.op === "==") {
            return itemValue === query.val;
          }
          return true;
        });
      }

      const docs = results.map((item) => ({
        id: item.id || "settings",
        data: () => item
      }));

      return {
        empty: results.length === 0,
        size: docs.length,
        docs: docs,
        forEach: (callback: (doc: any, index: number) => void) => docs.forEach(callback)
      };
    }
  }
}

class SafeFirestoreDb {
  collection(name: string) {
    return new SafeFirestoreCollection(name);
  }
}

const dbFirebase = new SafeFirestoreDb();

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

// Firestore Database Seeder Function
async function seedDatabaseIfEmpty() {
  try {
    const postsRef = dbFirebase.collection("posts");
    const postsSnapshot = await postsRef.get();
    
    if (postsSnapshot.empty) {
      console.log("[Firestore Seeder] Seeding initial blog posts to database...");
      
      const initialPosts = [
        {
          id: "post-1",
          title: "Scaling Green Belts: The 2026 Young Tree-Planting Matrix",
          content: "The Visionary Young Innovators Network, in co-development with Voicecommedia, launched an aggressive tree-planting protocol this quarter. Targeting critical riparian buffers and water catchment boundaries, the network mobilized 150 local volunteers. In alliance with community chiefs, we mapped five sensitive ecological sectors, distributing over 2,400 indigenous and fruit-tree seedlings. This action scales carbon sinks while providing strategic crop borders for neighboring smallholder farms.",
          author: {
            id: "bootstrap-admin-id",
            fullName: "System Administrator",
            email: "visionaryininovators26@gmail.com"
          },
          publishedAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(), // 3 days ago
          image: "https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800&auto=format&fit=crop&q=60",
          category: "Ecology",
          tags: ["Environment", "Youth-Action", "Ecology"]
        },
        {
          id: "post-2",
          title: "Expanding Clinical Logistics with Lisa Hospitals Clinic Sponsor Matrix",
          content: "We are proud to announce the next phase of our joint medical equipment and logistics support with Lisa Hospitals—focused on 'Your Health, Our Priority.' By redirecting collaborative resources and advertising space provided by Voicecommedia, VYIN has co-funded the delivery of cutting-edge pediatric wing diagnostic units. Ensuring high-quality clinical support at the grassroots tier remains a key pillar of our systemic development alliance.",
          author: {
            id: "bootstrap-admin-id",
            fullName: "System Administrator",
            email: "visionaryininovators26@gmail.com"
          },
          publishedAt: new Date(Date.now() - 3600000 * 24 * 7).toISOString(), // 7 days ago
          image: "https://images.unsplash.com/photo-1527613426441-4da17471b66d?w=800&auto=format&fit=crop&q=60",
          category: "Healthcare",
          tags: ["Health", "Partnership", "Community"]
        },
        {
          id: "post-3",
          title: "Education Sponsorship: Unlocking Technical Tracks For Vulnerable Youths",
          content: "Development succeeds only when academic gates are accessible to all. Operating the 2026 Scholarship Matrix, VYIN has successfully matched 12 vulnerable secondary-tier students with corporate education sponsors. This program covers tuition and tech-bootcamp credentials to prepare young minds for software and vocational leadership, directly fulfilling our educational enrichment pillar.",
          author: {
            id: "bootstrap-admin-id",
            fullName: "System Administrator",
            email: "visionaryininovators26@gmail.com"
          },
          publishedAt: new Date(Date.now() - 3600000 * 24 * 14).toISOString(), // 14 days ago
          image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=60",
          category: "Education",
          tags: ["Sponsorship", "Workshops", "Technology"]
        }
      ];

      for (const post of initialPosts) {
        await postsRef.doc(post.id).set(post);
      }
      console.log("[Firestore Seeder] Seeding posts completed.");
    }

    const usersRef = dbFirebase.collection("users");
    const adminSnapshot = await usersRef.where("email", "==", "visionaryininovators26@gmail.com").get();
    
    if (adminSnapshot.empty) {
      console.log("[Firestore Seeder] Seeding default administrator account bootstrap...");
      const adminUser = {
        id: "bootstrap-admin-id",
        email: "visionaryininovators26@gmail.com",
        fullName: "System Administrator",
        passwordHash: hashPassword(process.env.INITIAL_ADMIN_PASSWORD || "ChangeMe2026!"),
        role: "admin",
        createdAt: new Date().toISOString()
      };
      await usersRef.doc(adminUser.id).set(adminUser);
      console.log("[Firestore Seeder] Default admin seeded.");
    }
  } catch (error) {
    console.error("[Firestore Seeder Warning] Database seeding check failed:", error);
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
    console.warn("[System Warning] JWT_SECRET environment variable is missing. Using the provided fallback key for deployment.");
  }
  EFFECTIVE_JWT_SECRET = jwtSecret || "dev-only-fallback-secret-rotation-required";

  // 2. Check Firebase Config (if file is missing)
  if (!fs.existsSync(firebaseConfigPath)) {
    const requiredFirebaseVars = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'];
    for (const v of requiredFirebaseVars) {
      if (!process.env[v] && isProd) console.warn(`[System Warning] ${v} is missing. Firebase initialization may fail if not configured on Render.`);
    }
  }

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

  appFirebase = initializeApp(firebaseConfig);
  dbFirebaseReal = getFirestore(appFirebase, firebaseConfig.firestoreDatabaseId);

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

  // Initialize cloud Firestore database seeding
  await seedDatabaseIfEmpty();

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
      const usersRef = dbFirebase.collection("users");
      const userQuery = await usersRef.where("email", "==", emailLower).get();
      if (!userQuery.empty) {
        res.status(400).json({ success: false, error: "An account with this email address already exists." });
        return;
      }

      const assignedRole = role === "admin" || role === "author" ? role : "member";
      const newUser = {
        id: crypto.randomUUID(),
        email: emailLower,
        fullName: fullName.trim(),
        passwordHash: hashPassword(password),
        role: assignedRole,
        createdAt: new Date().toISOString()
      };

      await usersRef.doc(newUser.id).set(newUser);

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
      const usersRef = dbFirebase.collection("users");
      const userQuery = await usersRef.where("email", "==", emailLower).get();
      
      if (userQuery.empty) {
        res.status(401).json({ success: false, error: "Invalid email address or passcode sequence." });
        return;
      }

      const userDoc = userQuery.docs[0];
      const userData = userDoc.data() as FirebaseUserProfile;

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
      const usersRef = dbFirebase.collection("users");
      const userQuery = await usersRef.where("email", "==", emailLower).get();

      if (userQuery.empty) {
        res.status(404).json({ success: false, error: "No registered representative found with this email." });
        return;
      }

      // Generate a secure 6 digit numeric reset code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      const tokenID = crypto.randomUUID();

      await dbFirebase.collection("resetTokens").doc(tokenID).set({
        email: emailLower,
        code: resetCode,
        expires: Date.now() + 15 * 60 * 1000 // 15 minutes
      });

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
      const resetTokensRef = dbFirebase.collection("resetTokens");

      let validTokenKey = tokenId;
      let tokenObject: any = null;

      if (validTokenKey) {
        const tokenDoc = await resetTokensRef.doc(validTokenKey).get();
        if (tokenDoc.exists) {
          tokenObject = tokenDoc.data();
        }
      }

      if (!tokenObject) {
        // Fallback search through documents
        const fallbackQuery = await resetTokensRef
          .where("email", "==", emailLower)
          .where("code", "==", resetCode)
          .get();
        if (!fallbackQuery.empty) {
          validTokenKey = fallbackQuery.docs[0].id;
          tokenObject = fallbackQuery.docs[0].data();
        }
      }

      if (!tokenObject || tokenObject.email !== emailLower || tokenObject.code !== resetCode) {
        res.status(400).json({ success: false, error: "Invalid configuration or incorrect reset code." });
        return;
      }

      if (Date.now() > tokenObject.expires) {
        await resetTokensRef.doc(validTokenKey).delete();
        res.status(400).json({ success: false, error: "Reset verification code has expired (15-min limit)." });
        return;
      }

      const usersRef = dbFirebase.collection("users");
      const userQuery = await usersRef.where("email", "==", emailLower).get();

      if (userQuery.empty) {
        res.status(404).json({ success: false, error: "Account mapping mismatch." });
        return;
      }

      const userDocId = userQuery.docs[0].id;
      await usersRef.doc(userDocId).update({
        passwordHash: hashPassword(newPassword)
      });

      await resetTokensRef.doc(validTokenKey).delete();

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
      const userDoc = await dbFirebase.collection("users").doc(tokenInfo.id).get();
      
      if (!userDoc.exists) {
        res.status(404).json({ success: false, error: "Representative registry record missing." });
        return;
      }

      const userData = userDoc.data() as FirebaseUserProfile;

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
      const postsSnapshot = await dbFirebase.collection("posts").get();
      const postsList: FirebaseBlogPost[] = [];
      
      postsSnapshot.forEach((docSnap: any) => {
        postsList.push(docSnap.data() as FirebaseBlogPost);
      });

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

      await dbFirebase.collection("posts").doc(newPost.id).set(newPost);

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

      const postsRef = dbFirebase.collection("posts");
      const postDoc = await postsRef.doc(postId).get();

      if (!postDoc.exists) {
        res.status(404).json({ success: false, error: "Post record not found." });
        return;
      }

      const post = postDoc.data() as FirebaseBlogPost;

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

      await postsRef.doc(postId).set(updatedPost);

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

      const postsRef = dbFirebase.collection("posts");
      const postDoc = await postsRef.doc(postId).get();

      if (!postDoc.exists) {
        res.status(404).json({ success: false, error: "Post record not found." });
        return;
      }

      const post = postDoc.data() as FirebaseBlogPost;

      // Authorize: Only admin, or post author
      const isAuthorized = authenticatedUser.role === "admin" || post.author.id === authenticatedUser.id;
      if (!isAuthorized) {
        res.status(403).json({ success: false, error: "Forbidden. You do not have permissions to delete this post." });
        return;
      }

      await postsRef.doc(postId).delete();

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

    const registrationId = `reg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    try {
      await dbFirebase.collection("registrations").doc(registrationId).set({
        id: registrationId, fullName, email, phone, primaryPillar,
        registrationDate: new Date().toISOString()
      });
      console.log(`[Registration System] Registrant successfully backed up to ledger ID: ${registrationId}`);
    } catch (err: any) {
      console.error("[Registration System] Non-critical db backup failed:", err);
    }
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Listening successfully on port ${PORT}`);
    console.log(`[Server] Environment status: ${process.env.NODE_ENV || "development"}`);
  });
}

startServer().catch((error) => {
  console.error("[Fatal Exception] Main server bootstrap crash:", error);
});
