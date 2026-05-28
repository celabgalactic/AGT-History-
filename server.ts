import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Sync AgtOfficialLogo.png with AGTicon.png if it is empty
  const iconPath = path.join(process.cwd(), 'public', 'AGTicon.png');
  const officialLogoPath = path.join(process.cwd(), 'public', 'AgtOfficialLogo.png');
  try {
    if (fs.existsSync(iconPath)) {
      if (!fs.existsSync(officialLogoPath) || fs.statSync(officialLogoPath).size === 0) {
        fs.copyFileSync(iconPath, officialLogoPath);
        console.log("Successfully initialized AgtOfficialLogo.png from AGTicon.png");
      }
    }
  } catch (err) {
    console.warn("Failed to sync AgtOfficialLogo.png:", err);
  }

  // Proxy route for Google Drive assets to bypass CORS
  app.get("/api/asset-proxy", async (req, res) => {
    const fileId = req.query.id as string;
    if (!fileId) return res.status(400).send("Missing ID");

    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const response = await fetch(driveUrl);
      
      if (!response.ok) throw new Error("Failed to fetch from Drive");

      // Forward relevant headers
      const contentType = response.headers.get("content-type");
      if (contentType) res.setHeader("Content-Type", contentType);
      
      // Add CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=31536000");

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error("Proxy error:", error);
      res.status(500).send("Error proxying asset");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
