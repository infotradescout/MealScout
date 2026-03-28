import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const viteModule = (await (0, eval)('import("vite")')) as typeof import("vite");
  const { createServer: createViteServer, createLogger } = viteModule;
  const viteLogger = createLogger();
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };
  const configFile = path.resolve(process.cwd(), "client", "vite.config.ts");

  const vite = await createViteServer({
    configFile,
    customLogger: {
      ...viteLogger,
        error: (msg: any, options: any) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        moduleDir,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // In production, server code is in dist/ and public assets are in dist/public
  // server module resolves from dist/, so we look for public/ relative to it
  const distPath = path.resolve(moduleDir, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        // Service workers and web manifests must be revalidated to allow updates.
        if (
          filePath.endsWith(`${path.sep}sw.js`) ||
          filePath.endsWith(`${path.sep}manifest.json`) ||
          filePath.endsWith(".webmanifest")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return;
        }
        if (filePath.endsWith(".html")) {
          res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate",
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
