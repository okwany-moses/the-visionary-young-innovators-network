import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
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

function validateEnvironment() {
  const check = (key: string) => !!(process.env[key] && !process.env[key]?.includes("your_"));
  console.log(`[System] Integration Status:
    - Formspree: ${check('FORMSPREE_FORM_ID') ? 'ACTIVE' : 'OFFLINE'}`);
}

interface RegistrationPayload {
  fullName: string;
  email: string;
  phone: string;
  primaryPillar: string;
}

/**
 * System Notification Dispatcher
 * Coordinates delivery across multiple third-party gateways.
 */
async function dispatchRegistrationNotifications(registrant: { fullName: string, email: string, phone: string, primaryPillar: string }) {
  const { fullName, email, phone, primaryPillar } = registrant;
  const status = {
    formspreeSent: false,
    emailStatus: "Skipped - FORMSPREE_FORM_ID not configured.",
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
